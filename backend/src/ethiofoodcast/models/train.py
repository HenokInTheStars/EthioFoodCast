"""Nested, target-domain-aware cross-validation.

One outer fold, in full:

    hold out whole EAs -> drop ALL their households from training
      train on the remaining matched households (wide, or narrow, or weighted)
        inner folds pick the decision threshold, scored on AGRICULTURAL rows
      score on the AGRICULTURAL households of the held-out EAs
"""

from __future__ import annotations

import logging
import warnings

import numpy as np
import pandas as pd
from sklearn.pipeline import Pipeline

from ..config.constants import RANDOM_SEED
from ..evaluation.metrics import (
    evaluate,
    threshold_for_accuracy,
    threshold_for_f1,
    threshold_for_precision,
    threshold_for_recall,
)
from . import registry
from .preprocess import build_preprocessor, collapse_missing_flags, drop_degenerate, to_numeric_frame
from .splits import assert_no_ea_overlap, inner_folds, outer_folds

LOGGER = logging.getLogger(__name__)

TARGET_RECALL = 0.80
TARGET_PRECISION = 0.75

# An outer fold whose inner loop mostly failed has no basis for a threshold,
# so falling back to 0.5 would quietly report a number nobody chose.
MIN_INNER_SUCCESSES = 2

# How the operating point is chosen. "recall" suits screening (a missed
# household is the costly error); "precision" suits a fixed assessment budget;
# "f1" balances them. Always chosen on agricultural validation rows only.
THRESHOLD_STRATEGIES = {
    "recall": lambda y, s: threshold_for_recall(y, s, TARGET_RECALL),
    "precision": lambda y, s: threshold_for_precision(y, s, TARGET_PRECISION),
    "f1": threshold_for_f1,
    "accuracy": threshold_for_accuracy,
}

# The three training designs compared on identical agricultural folds.
VARIANTS = {
    "M1_narrow": "agricultural households only",
    "M2_wide": "all matched households, unweighted",
    "M3_wide_weighted": "all matched, non-agricultural down-weighted",
}
NON_AG_WEIGHT = 0.4  # tuned properly at Stage 7; a sensible middle for now


def _supports_sample_weight(estimator) -> bool:
    import inspect

    return "sample_weight" in inspect.signature(estimator.fit).parameters


def _resample_to_weights(X, y, weights):
    """Approximate sample weights by subsampling the down-weighted rows."""
    rng = np.random.default_rng(RANDOM_SEED)
    keep = rng.random(len(weights)) < np.clip(weights, 0, 1)
    if keep.sum() < 50:
        return X, y
    return X[keep], y[keep]


def _fit_predict(model_name, X_train, y_train, weights, X_test):
    estimator = registry.build(
        model_name,
        class_weight="balanced"
        if model_name in registry.SUPPORTS_CLASS_WEIGHT
        else None,
    )
    scale = model_name in registry.NEEDS_SCALING
    # The training fold decides which columns are skewed, so the log transform
    # is fitted fold-locally like everything else.
    pipeline = Pipeline(
        [
            (
                "prep",
                build_preprocessor(
                    list(X_train.columns), scale=scale, frame=X_train
                ),
            ),
            ("model", estimator),
        ]
    )

    # sklearn's MLPClassifier does not accept sample_weight. Rather than drop
    # the M3 design for the neural net, the weights are applied by resampling:
    # non-agricultural rows are subsampled to NON_AG_WEIGHT of their number,
    # which reproduces the same effective emphasis.
    fit_kwargs = {}
    if weights is not None:
        if _supports_sample_weight(estimator):
            fit_kwargs["model__sample_weight"] = weights
        else:
            X_train, y_train = _resample_to_weights(X_train, y_train, weights)

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        pipeline.fit(X_train, y_train, **fit_kwargs)
        return pipeline, pipeline.predict_proba(X_test)[:, 1]


def _training_rows(frame: pd.DataFrame, variant: str):
    """Rows used for fitting, and their sample weights."""
    if variant == "M1_narrow":
        rows = frame[frame["is_agricultural"] == 1]
        return rows, None
    if variant == "M2_wide":
        return frame, None

    weights = np.where(frame["is_agricultural"] == 1, 1.0, NON_AG_WEIGHT)
    return frame, weights


def run_variant(
    data: pd.DataFrame,
    features: list[str],
    target: str,
    model_name: str,
    variant: str,
    n_splits: int = 5,
    threshold_strategy: str = "recall",
) -> tuple[list[dict], list[dict]]:
    """Nested CV for one (model, variant). Returns per-fold metrics and details."""
    # No screening happens here. An earlier version collapsed missingness flags
    # by name before the fold loop, which destroyed 20 of 46 flags that carry
    # information distinct from their block-mate -- and the later value-based
    # check could not recover a column already gone. Both screens now run
    # inside the training fold, on training data only.
    fold_metrics, details = [], []

    for fold, (train_idx, test_idx) in enumerate(outer_folds(data, target, n_splits)):
        train = data.iloc[train_idx]
        test = data.iloc[test_idx]
        assert_no_ea_overlap(train, test)

        # Scoring is agricultural-only, on both sides.
        test_ag = test[(test["is_agricultural"] == 1) & test[target].notna()]
        if len(test_ag) < 20 or test_ag[target].nunique() < 2:
            continue

        # Drop unusable rows first, then derive weights, so the weight vector
        # always lines up with the rows actually fitted.
        fit_rows = train[train[target].notna()]
        fit_rows, weights = _training_rows(fit_rows, variant)

        # Both screens fitted on the training fold only: duplicate-flag
        # detection by value, then variance screening.
        fold_columns = collapse_missing_flags(features, fit_rows)
        fold_features = drop_degenerate(to_numeric_frame(fit_rows, fold_columns))

        X_train = to_numeric_frame(fit_rows, fold_features)
        y_train = fit_rows[target].astype(int)

        # --- inner loop: choose the threshold on agricultural rows only ---
        thresholds, inner_attempts, inner_failures = [], 0, []
        for inner_train_idx, inner_val_idx in inner_folds(fit_rows, target, 3):
            inner_attempts += 1
            inner_train = fit_rows.iloc[inner_train_idx]
            inner_val = fit_rows.iloc[inner_val_idx]
            inner_val_ag = inner_val[inner_val["is_agricultural"] == 1]
            if len(inner_val_ag) < 20 or inner_val_ag[target].nunique() < 2:
                continue

            # Re-screen on the inner training rows. Reusing `fold_features`
            # selected on the whole outer training set let the inner
            # validation rows influence which columns the inner model saw --
            # the same leak that was fixed in the export path.
            inner_columns = collapse_missing_flags(features, inner_train)
            inner_features = drop_degenerate(
                to_numeric_frame(inner_train, inner_columns)
            )

            _, inner_weights = _training_rows(inner_train, variant)
            try:
                _, scores = _fit_predict(
                    model_name,
                    to_numeric_frame(inner_train, inner_features),
                    inner_train[target].astype(int),
                    inner_weights,
                    to_numeric_frame(inner_val_ag, inner_features),
                )
            except Exception as exc:
                inner_failures.append(f"{type(exc).__name__}: {exc}")
                LOGGER.warning(
                    "%s/%s fold %d: inner fit failed (%s)",
                    model_name, variant, fold, type(exc).__name__,
                )
                continue

            choose = THRESHOLD_STRATEGIES[threshold_strategy]
            thresholds.append(
                choose(inner_val_ag[target].astype(int), scores)
            )

        if len(thresholds) < MIN_INNER_SUCCESSES:
            # Report the fold as unusable rather than scoring it at an
            # arbitrary 0.5 that no validation data supports.
            LOGGER.warning(
                "%s/%s fold %d skipped: only %d/%d inner folds succeeded (%s)",
                model_name, variant, fold, len(thresholds), inner_attempts,
                "; ".join(inner_failures[:2]) or "no positives in validation",
            )
            continue

        threshold = float(np.median(thresholds))

        # --- outer: fit on the fold's training rows, score agricultural test ---
        _, test_scores = _fit_predict(
            model_name, X_train, y_train, weights,
            to_numeric_frame(test_ag, fold_features),
        )

        metrics = evaluate(test_ag[target].astype(int), test_scores, threshold)
        metrics["fold"] = fold
        metrics["threshold"] = threshold
        fold_metrics.append(metrics)

        details.append(
            {
                "fold": fold,
                "n_train": len(fit_rows),
                "n_train_agricultural": int((fit_rows["is_agricultural"] == 1).sum()),
                "n_test_agricultural": len(test_ag),
                "threshold": threshold,
                "inner_folds_used": len(thresholds),
                "inner_folds_failed": len(inner_failures),
            }
        )

    return fold_metrics, details

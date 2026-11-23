"""The single inference artifact the UI calls.

**The rule: the UI never recomputes anything.** Preprocessing, the model, the
cluster assigner, the risk bands and the rules engine all travel together in
one object, so there is exactly one code path from a raw household dict to a
prediction -- the same one used in training. A frontend re-implementing feature
engineering in JavaScript is how a system starts disagreeing with its own
evaluation.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from ..export.privacy import CAVEATS

# Bands over predicted probability. Cut at the observed base rate and at the
# point where precision@k stops being useful, not at round numbers.
RISK_BANDS = ((0.0, 0.45, "Low"), (0.45, 0.70, "Moderate"), (0.70, 1.01, "High"))


def git_sha() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip() or "unknown"
    except Exception:  # noqa: BLE001
        return "unknown"


def band_of(probability: float) -> str:
    for low, high, label in RISK_BANDS:
        if low <= probability < high:
            return label
    return "High"


@dataclass
class ModelBundle:
    """Everything needed to score a household, versioned together."""

    pipeline: Any
    features: list[str]
    cluster_model: Any = None
    cluster_features: list[str] = field(default_factory=list)
    cluster_scaler: Any = None
    cluster_names: dict[int, str] = field(default_factory=dict)
    explainer: Any = None
    explainer_names: list[str] = field(default_factory=list)
    #: Operating threshold chosen on grouped out-of-fold predictions.
    #: Part of the model, not a UI setting: a caller inventing its own
    #: cutoff is not running the configuration that was evaluated.
    threshold: float = 0.5
    #: The generated feature schema, carried with the model so validation
    #: uses the same ranges and codes the model was trained on.
    schema: list = field(default_factory=list)
    metadata: dict = field(default_factory=dict)

    def version(self) -> dict:
        """Provenance recorded when the model was FITTED, not when asked.

        Calling git_sha() and date.today() here reported the current checkout
        and today's date, so a model trained weeks ago looked freshly trained
        on a different commit. Both are captured once, at construction.
        """
        return {
            "git_sha": self.metadata.get("git_sha", "unknown"),
            "trained": self.metadata.get("trained", "unknown"),
            "n_features": len(self.features),
            **{k: v for k, v in self.metadata.items()
               if k not in ("git_sha", "trained")},
        }

    def to_frame(self, household: dict) -> pd.DataFrame:
        """One-row frame with every expected feature, missing ones as NaN.

        A household supplied through a short form will not carry all features.
        Absent values become NaN and the pipeline's fold-fitted imputer handles
        them -- the same treatment they received in training.
        """
        row = {f: household.get(f, np.nan) for f in self.features}
        return pd.DataFrame([row])[self.features].apply(
            pd.to_numeric, errors="coerce"
        ).astype("float64")

    def predict(self, household: dict, *, strict: bool = True) -> dict:
        """Raw dict in, complete decision-support result out."""
        from ..contracts.validation import validate
        from ..rules.engine import evaluate as evaluate_rules

        # Validate before scoring. Without this an empty dict returned 0.6018
        # "Moderate" with flagged=True -- an assessment recommendation built
        # from no information whatsoever.
        checked = validate(household, self.schema, strict=strict)
        frame = self.to_frame(checked.cleaned)
        probability = float(self.pipeline.predict_proba(frame)[:, 1][0])

        result: dict = {
            # No probability at all when the input cannot support one. Showing
            # 0.6018 for an empty form invites a reader to treat the training
            # median as this household's risk -- the band alone is not enough
            # of a warning once a number is on the screen.
            "probability": round(probability, 4) if checked.sufficient else None,
            # The BAND describes the probability. The FLAG is the operating
            # decision at the chosen threshold. They answer different
            # questions and can disagree -- two households can both be
            # "Moderate" while only one crosses the threshold.
            "risk_band": band_of(probability) if checked.sufficient else "Insufficient data",
            "band_meaning": "descriptive label for the probability",
            "threshold": self.threshold,
            "flagged": bool(probability >= self.threshold) if checked.sufficient else False,
            "flag_meaning": (
                f"selected for assessment at threshold {self.threshold:.3f}; "
                "this is the operating decision, not the band"
            ),
            # Usable numeric values, not keys present. The old count treated
            # NaN, strings and lists as supplied.
            "n_features_supplied": checked.n_valid,
            "n_predictive_supplied": checked.n_predictive,
            "n_features_expected": len(self.features),
            "sufficient_data": checked.sufficient,
            "warnings": checked.warnings,
            "model_version": self.version(),
            "caveats": CAVEATS,
        }

        # Factors explain a probability; without one there is nothing to
        # decompose.
        result["top_factors"] = self._factors(frame) if checked.sufficient else []
        result["cluster"] = self._cluster(checked.cleaned)
        result["recommendations"] = (
            evaluate_rules(checked.cleaned) if checked.sufficient else []
        )
        return result

    def _factors(self, frame: pd.DataFrame) -> list[dict]:
        if self.explainer is None:
            return []
        try:
            transformed = self.pipeline.named_steps["prep"].transform(frame)
            values = self.explainer.shap_values(transformed, check_additivity=False)
            if isinstance(values, list):
                values = values[1] if len(values) > 1 else values[0]
            values = np.asarray(values)
            if values.ndim == 3:
                values = values[:, :, -1]
            values = values[0]
        except Exception:  # noqa: BLE001
            return []

        order = np.argsort(np.abs(values))[::-1][:6]
        out = []
        for i in order:
            encoded = (
                self.explainer_names[i] if i < len(self.explainer_names) else f"f{i}"
            )
            source, label = self._decode_feature_name(encoded)
            out.append(
                {
                    "feature": label,
                    "source_field": source,
                    "encoded_name": encoded,
                    "contribution": round(float(values[i]), 4),
                    "direction": "increases risk" if values[i] > 0 else "reduces risk",
                }
            )
        return out

    def _decode_feature_name(self, encoded: str) -> tuple[str, str]:
        """Turn a ColumnTransformer output name into something showable.

        The transformer emits ``categorical__w4_region_7.0``. Putting that in
        front of a field officer is not an explanation. ``source_field`` is
        kept alongside so the UI can join back to the schema for ranges and
        allowed values; ``encoded_name`` is kept so nothing is lost.
        """
        name = encoded
        for prefix in ("numeric__", "categorical__", "binary__", "remainder__"):
            if name.startswith(prefix):
                name = name[len(prefix) :]
                break

        # A one-hot column is "<field>_<category>", but field names contain
        # underscores too, so match against the known fields longest-first
        # rather than splitting on the last underscore.
        if name not in self.features:
            for candidate in sorted(self.features, key=len, reverse=True):
                if name.startswith(candidate + "_"):
                    category = name[len(candidate) + 1 :]
                    if category.endswith(".0"):
                        category = category[:-2]
                    return candidate, f"{candidate} = {category}"
        return name, name

    def _cluster(self, household: dict) -> dict | None:
        if self.cluster_model is None or not self.cluster_features:
            return None
        row = pd.DataFrame(
            [[household.get(f, np.nan) for f in self.cluster_features]],
            columns=self.cluster_features,
        ).apply(pd.to_numeric, errors="coerce")

        try:
            # The centroids live on the standardised scale the clusterer was
            # fitted on. Passing raw values collapses every household into one
            # segment, because land area in square metres dwarfs every other
            # dimension.
            if self.cluster_scaler is not None:
                row = self.cluster_scaler.transform(row)
            label = int(self.cluster_model.predict(row)[0])
        except Exception:  # noqa: BLE001
            return None
        return {"id": label, "name": self.cluster_names.get(label, f"Segment {label}")}


class IncompatibleEnvironment(RuntimeError):
    """The installed scikit-learn cannot read the pickled bundle.

    Raised in place of the ``AttributeError`` pickle throws from deep inside
    its own internals, which names a private class and gives the reader no
    idea that the fix is a pip install.
    """


def _sklearn_version() -> str:
    import sklearn

    return sklearn.__version__


def save(bundle: ModelBundle, path: Path) -> Path:
    import joblib

    # Record the environment the pickle was written in, so a mismatch on the
    # far side can be reported as a version problem rather than discovered as
    # a pickle error.
    bundle.metadata.setdefault("sklearn_version", _sklearn_version())
    bundle.metadata.setdefault("numpy_version", np.__version__)
    bundle.metadata.setdefault("pandas_version", pd.__version__)

    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, path)
    return path


def load(path: Path) -> ModelBundle:
    import joblib

    try:
        bundle = joblib.load(path)
    except Exception as exc:  # noqa: BLE001 - re-raised with a usable message
        raise IncompatibleEnvironment(
            f"Could not load {path.name}. This is almost always a scikit-learn "
            f"version mismatch: the bundle is a pickle of fitted scikit-learn "
            f"objects and only loads under the version that wrote it. You have "
            f"{_sklearn_version()}. Install the pinned set with "
            f"`pip install -r backend/requirements.txt` (Python 3.11 or 3.12). "
            f"Underlying error: {type(exc).__name__}: {exc}"
        ) from exc

    built_with = bundle.metadata.get("sklearn_version")
    if built_with and built_with != _sklearn_version():
        # It loaded, so nothing is broken outright -- but silently different
        # numbers are worse than a loud one, and the pickle warning scrolls past.
        bundle.metadata["environment_warning"] = (
            f"Bundle was fitted under scikit-learn {built_with}; "
            f"{_sklearn_version()} is installed. Predictions may differ. "
            f"Install the pinned version from backend/requirements.txt."
        )
    return bundle

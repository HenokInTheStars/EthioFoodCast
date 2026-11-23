"""The model family being compared.

Every estimator is deliberately constrained: at ~1,950 rows with ~160
features, an unconstrained booster will fit the training folds perfectly and
learn nothing that transfers.

**Selected model: `extra_trees`.** Best on every metric measured at Stage 6
(PR-AUC 0.737, ROC 0.676, precision@25% 0.790) and 11x faster to fit than the
stacking ensemble it beat. Randomising split points rather than optimising
them trades a little bias for much less variance, which is the right trade at
this sample size -- see reports/stage6_revised_findings.md.
"""

from __future__ import annotations

from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier

from ..config.constants import RANDOM_SEED

# Trees split on raw values, so scaling is unnecessary; the linear model and
# the neural network both require it.
NEEDS_SCALING = {"logistic_regression", "mlp"}


def _xgboost():
    from xgboost import XGBClassifier

    return XGBClassifier(
        n_estimators=300, max_depth=4, learning_rate=0.05,
        subsample=0.8, colsample_bytree=0.8,
        min_child_weight=5, reg_lambda=2.0,
        eval_metric="aucpr", random_state=RANDOM_SEED, n_jobs=-1,
    )


def _lightgbm():
    from lightgbm import LGBMClassifier

    return LGBMClassifier(
        n_estimators=300, max_depth=4, learning_rate=0.05,
        subsample=0.8, colsample_bytree=0.8,
        min_child_samples=20, reg_lambda=2.0,
        random_state=RANDOM_SEED, n_jobs=-1, verbose=-1,
    )


def _catboost():
    """Ordered boosting, designed for exactly this regime.

    CatBoost's ordered target statistics were built to stop small datasets
    overfitting through target leakage in the boosting loop -- the failure mode
    that plausibly held XGBoost and LightGBM below random forest here at
    ~1,550 training rows per fold.
    """
    from catboost import CatBoostClassifier

    return CatBoostClassifier(
        iterations=500, depth=4, learning_rate=0.03,
        l2_leaf_reg=6.0, bagging_temperature=1.0,
        loss_function="Logloss", eval_metric="PRAUC",
        random_seed=RANDOM_SEED, verbose=0, allow_writing_files=False,
    )


def _extra_trees(class_weight=None):
    """Extremely randomised trees: more variance reduction than a forest.

    Split points are chosen at random rather than optimised, which trades a
    little bias for a lot less variance -- the right trade when the signal is
    weak and the sample is small.
    """
    from sklearn.ensemble import ExtraTreesClassifier

    return ExtraTreesClassifier(
        n_estimators=800, max_depth=10, min_samples_leaf=8,
        max_features="sqrt", class_weight=class_weight,
        random_state=RANDOM_SEED, n_jobs=-1,
    )


def _hist_boosting():
    """sklearn's histogram booster, with native categorical handling."""
    from sklearn.ensemble import HistGradientBoostingClassifier

    return HistGradientBoostingClassifier(
        max_iter=400, max_depth=4, learning_rate=0.05,
        min_samples_leaf=20, l2_regularization=2.0,
        early_stopping=True, validation_fraction=0.15,
        n_iter_no_change=25, random_state=RANDOM_SEED,
    )


def _balanced_forest():
    """A forest that resamples each tree to balance the classes.

    Aimed at recall on the minority class without the probability distortion
    that SMOTE introduces.
    """
    from imblearn.ensemble import BalancedRandomForestClassifier

    return BalancedRandomForestClassifier(
        n_estimators=500, max_depth=8, min_samples_leaf=10,
        sampling_strategy="auto", replacement=True,
        bootstrap=False, random_state=RANDOM_SEED, n_jobs=-1,
    )


def _stacking(class_weight=None):
    """Stack the diverse families under a regularised linear meta-learner.

    Stacking pays off when the base models make *different* mistakes. Here a
    forest, a booster and a linear model disagree fold by fold, so there is
    something for the meta-learner to arbitrate.
    """
    from sklearn.ensemble import StackingClassifier
    from sklearn.model_selection import StratifiedKFold

    return StackingClassifier(
        estimators=[
            ("rf", build("random_forest", class_weight)),
            ("et", _extra_trees(class_weight)),
            ("hgb", _hist_boosting()),
        ],
        final_estimator=LogisticRegression(
            C=0.5, max_iter=2000, class_weight=class_weight,
            random_state=RANDOM_SEED,
        ),
        cv=StratifiedKFold(5, shuffle=True, random_state=RANDOM_SEED),
        stack_method="predict_proba",
        n_jobs=1,
    )


def build(name: str, class_weight=None):
    """Return a fresh estimator. `class_weight` is applied where supported."""
    if name == "logistic_regression":
        return LogisticRegression(
            penalty="elasticnet", solver="saga", l1_ratio=0.5, C=0.1,
            max_iter=3000, class_weight=class_weight, random_state=RANDOM_SEED,
        )
    if name == "random_forest":
        return RandomForestClassifier(
            n_estimators=500, max_depth=8, min_samples_leaf=10,
            max_features="sqrt", class_weight=class_weight,
            random_state=RANDOM_SEED, n_jobs=-1,
        )
    if name == "xgboost":
        return _xgboost()
    if name == "lightgbm":
        return _lightgbm()
    if name == "mlp":
        # The architecture from the project brief: 128 -> 64 -> 32 -> sigmoid.
        # sklearn rather than torch: the torch install on this machine has a
        # broken DLL, and at this sample size the two are equivalent for a
        # plain feed-forward net.
        return MLPClassifier(
            hidden_layer_sizes=(128, 64, 32), activation="relu",
            alpha=1e-3, learning_rate_init=1e-3, max_iter=500,
            early_stopping=True, n_iter_no_change=15,
            random_state=RANDOM_SEED,
        )
    if name == "extra_trees":
        return _extra_trees(class_weight)
    if name == "hist_boosting":
        return _hist_boosting()
    if name == "balanced_forest":
        return _balanced_forest()
    if name == "catboost":
        return _catboost()
    if name == "stacking":
        return _stacking(class_weight)
    raise ValueError(f"unknown model {name!r}")


# The model the project ships. Everything else stays in the registry so the
# comparison stays reproducible and the baseline stays available.
SELECTED_MODEL = "extra_trees"

ALL_MODELS = (
    "logistic_regression",
    "random_forest",
    "xgboost",
    "lightgbm",
    "mlp",
    "extra_trees",
    "hist_boosting",
    "balanced_forest",
    "catboost",
    "stacking",
)

# Families that accept class_weight directly.
SUPPORTS_CLASS_WEIGHT = {
    "logistic_regression", "random_forest", "extra_trees", "stacking",
}

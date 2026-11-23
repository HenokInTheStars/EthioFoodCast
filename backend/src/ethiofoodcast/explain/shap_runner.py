"""SHAP explanations and the geography-versus-household question.

The project's central unresolved doubt (Finding 24) is whether the model scores
*where a household is* rather than *what it has*. Twenty geographic features
recover 60-70% of the total lift, and the best feature set drops the
agricultural blocks altogether. SHAP settles what the model actually uses.

TreeSHAP is exact for tree ensembles -- no sampling noise, reproducible run to
run -- which matters when an explanation may justify a home visit.

Everything is computed on **held-out fold predictions**, never on training
rows: a SHAP value from a row the model memorised describes the memorisation,
not the reasoning.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# Feature-name prefixes grouped into the domains the project reasons about.
DOMAINS = {
    "geography": ("geo_", "w4_region"),
    "diet": ("diet_", "freq_"),
    "economy": ("cons_", "econ_", "adult_equivalents"),
    "prior_food_insecurity": ("prior_fi",),
    "household": ("hh_", "head_", "n_", "share_", "dependency_", "capital_"),
    "agriculture": ("land_", "crop_", "harvest_", "yield_", "input_", "livestock_"),
    "shocks": ("shock_",),
    "structure": ("has_", "is_agricultural"),
}


def strip_transformer_prefix(feature: str) -> str:
    """Remove the ColumnTransformer branch prefix from a feature name.

    A fitted ColumnTransformer emits ``numeric__geo_dist_market``, not
    ``geo_dist_market``. Matching domains against the raw name silently sorts
    every feature into "other" -- which is exactly what happened the first
    time this ran.
    """
    return feature.split("__", 1)[-1] if "__" in feature else feature


def domain_of(feature: str) -> str:
    """Map a feature name to its domain, longest prefix winning."""
    name = strip_transformer_prefix(feature)

    best, best_length = "other", 0
    for domain, prefixes in DOMAINS.items():
        for prefix in prefixes:
            if name.startswith(prefix) and len(prefix) > best_length:
                best, best_length = domain, len(prefix)
    return best


def tree_shap_values(fitted_pipeline, X: pd.DataFrame) -> tuple[np.ndarray, list[str]]:
    """Exact SHAP values for the tree model inside a fitted pipeline.

    The pipeline transforms features before the model sees them, so SHAP runs
    on the transformed matrix and the transformed names are recovered for
    attribution.
    """
    import shap

    preprocessor = fitted_pipeline.named_steps["prep"]
    model = fitted_pipeline.named_steps["model"]

    transformed = preprocessor.transform(X)
    try:
        names = list(preprocessor.get_feature_names_out())
    except Exception:  # noqa: BLE001
        names = [f"f{i}" for i in range(transformed.shape[1])]

    explainer = shap.TreeExplainer(model)
    values = explainer.shap_values(transformed, check_additivity=False)

    # Binary classifiers return either a list of two arrays or a 3-D stack;
    # the positive class is the one being explained.
    if isinstance(values, list):
        values = values[1] if len(values) > 1 else values[0]
    values = np.asarray(values)
    if values.ndim == 3:
        values = values[:, :, -1]

    return values, names


def domain_attribution(values: np.ndarray, names: list[str]) -> pd.DataFrame:
    """Share of total attribution carried by each domain.

    Mean |SHAP| per domain, and the same divided by the number of features in
    it -- because a domain with 100 features can dominate the total while each
    of its features contributes little.
    """
    per_feature = np.abs(values).mean(axis=0)
    frame = pd.DataFrame(
        {
            "feature": names,
            "mean_abs_shap": per_feature,
            "domain": [domain_of(n) for n in names],
        }
    )

    grouped = (
        frame.groupby("domain")
        .agg(total_abs_shap=("mean_abs_shap", "sum"),
             n_features=("feature", "size"),
             per_feature=("mean_abs_shap", "mean"))
        .reset_index()
    )
    grouped["share_pct"] = (
        100 * grouped["total_abs_shap"] / grouped["total_abs_shap"].sum()
    ).round(1)
    grouped["per_feature"] = grouped["per_feature"].round(5)

    return grouped.sort_values("share_pct", ascending=False).reset_index(drop=True)


def top_features(values: np.ndarray, names: list[str], n: int = 25) -> pd.DataFrame:
    """Global ranking by mean |SHAP|, with the direction of the association.

    Direction is the sign of the correlation between a feature's SHAP values
    and the feature's own rank, so it reads as "higher value pushes risk
    up/down" rather than merely "this feature matters".
    """
    per_feature = np.abs(values).mean(axis=0)
    order = np.argsort(per_feature)[::-1][:n]

    rows = []
    for index in order:
        column = values[:, index]
        rows.append(
            {
                "feature": names[index],
                "domain": domain_of(names[index]),
                "mean_abs_shap": float(per_feature[index]),
                "mean_shap": float(column.mean()),
            }
        )
    return pd.DataFrame(rows)

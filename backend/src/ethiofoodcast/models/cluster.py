"""Household vulnerability profiling.

Clustering answers a different question from the model. The model asks *how
likely is this household to become food insecure*; clustering asks *what kind
of vulnerable household is this*. Two households at the same 70% risk may need
completely different responses -- one has lost a harvest, another has enough
food but no way to reach a market.

Because the question differs, so does the feature set. The agricultural blocks
are included here even though they did not improve prediction: land, livestock
and irrigation define the *type* of household even where they fail to forecast
the outcome.

Two constraints are enforced deliberately:

* **A small, chosen feature set.** K-means on 187 mixed features produces
  clusters nobody can name. Only vulnerability-defining variables are used.
* **Interpretability beats silhouette.** A cluster that cannot be given a
  plain-language name is not useful to a field officer, whatever its score.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.cluster import AgglomerativeClustering, KMeans
from sklearn.impute import SimpleImputer
from sklearn.metrics import silhouette_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from ..config.constants import RANDOM_SEED

# The dimensions that define a vulnerability profile, chosen rather than
# discovered: productive land, animal wealth, crop strategy, water security,
# market access, dependency burden and consumption level.
PROFILE_FEATURES = (
    "land_total_area",
    "livestock_tlu",
    "crop_diversity",
    "land_any_irrigated",
    "geo_dist_market",
    "geo_rain_anomaly_2019",
    "dependency_ratio",
    "cons_per_adult_eq",
    "diet_n_groups",
    "econ_n_asset_types",
)

K_RANGE = range(2, 9)


def build_matrix(frame: pd.DataFrame, features=PROFILE_FEATURES):
    """Median-impute and standardise the profiling features.

    Returns the fitted transformer as well as the matrix. Serving *must* reuse
    it: k-means centroids live on the standardised scale, so scoring a raw
    household against them puts every household in whichever cluster has the
    largest centroid -- land area in square metres dwarfs a dependency ratio.
    """
    present = [c for c in features if c in frame.columns]
    values = frame[present].apply(pd.to_numeric, errors="coerce")

    pipeline = Pipeline(
        [("impute", SimpleImputer(strategy="median")), ("scale", StandardScaler())]
    )
    return pipeline.fit_transform(values), present, pipeline


def choose_k(matrix: np.ndarray) -> pd.DataFrame:
    """Silhouette and inertia across the candidate range."""
    rows = []
    for k in K_RANGE:
        model = KMeans(n_clusters=k, n_init=20, random_state=RANDOM_SEED)
        labels = model.fit_predict(matrix)
        rows.append(
            {
                "k": k,
                "silhouette": round(float(silhouette_score(matrix, labels)), 4),
                "inertia": round(float(model.inertia_), 1),
                "smallest_cluster_pct": round(
                    100 * pd.Series(labels).value_counts(normalize=True).min(), 1
                ),
            }
        )
    return pd.DataFrame(rows)


def fit_kmeans(matrix: np.ndarray, k: int):
    model = KMeans(n_clusters=k, n_init=50, random_state=RANDOM_SEED)
    return model, model.fit_predict(matrix)


def gower_matrix(frame: pd.DataFrame, features: list[str]) -> np.ndarray:
    """Gower distance: range-normalised per feature, averaged across features.

    Used as a robustness check because it treats each variable on its own scale
    rather than assuming Euclidean geometry after standardisation. If the two
    methods disagree about structure, the clusters are an artefact of the
    distance metric and should be reported as such.
    """
    # astype("float64") is required, not cosmetic: pandas nullable Float64
    # columns produce an object-dtype array, and the accumulation below then
    # fails with a ufunc casting error.
    values = frame[features].apply(pd.to_numeric, errors="coerce").astype("float64")
    values = values.fillna(values.median())

    spans = (values.max() - values.min()).replace(0, 1.0)
    normalised = ((values - values.min()) / spans).to_numpy(dtype="float64")

    n = normalised.shape[0]
    distance = np.zeros((n, n))
    for j in range(normalised.shape[1]):
        column = normalised[:, j][:, None]
        distance += np.abs(column - column.T)
    return distance / normalised.shape[1]


def hierarchical_labels(distance: np.ndarray, k: int) -> np.ndarray:
    model = AgglomerativeClustering(
        n_clusters=k, metric="precomputed", linkage="average"
    )
    return model.fit_predict(distance)


def profile(frame: pd.DataFrame, labels, features: list[str], target: str):
    """Describe each cluster by its features and its observed outcome rate.

    The outcome rate is what connects profiling back to the prediction task:
    a segment is only actionable if it differs in risk as well as in character.
    """
    working = frame.copy()
    working["cluster"] = labels

    overall = working[features].apply(pd.to_numeric, errors="coerce").mean()
    rows = []

    for cluster, group in working.groupby("cluster"):
        entry = {
            "cluster": int(cluster),
            "n": len(group),
            "pct": round(100 * len(group) / len(working), 1),
            "food_insecure_rate": round(float(group[target].mean()), 3),
        }
        numeric = group[features].apply(pd.to_numeric, errors="coerce").mean()
        for feature in features:
            entry[feature] = round(float(numeric[feature]), 3)
            # Deviation from the population mean, in population SD units --
            # this is what makes a cluster nameable.
            spread = (
                working[feature].apply(pd.to_numeric, errors="coerce").std()
            )
            entry[f"{feature}__z"] = (
                round(float((numeric[feature] - overall[feature]) / spread), 2)
                if spread and not pd.isna(spread) and spread != 0
                else 0.0
            )
        rows.append(entry)

    return pd.DataFrame(rows).sort_values("food_insecure_rate", ascending=False)


def name_cluster(row: pd.Series, features: list[str], threshold: float = 0.5) -> str:
    """Plain-language label from a cluster's most distinctive dimensions."""
    deviations = {
        feature: row[f"{feature}__z"]
        for feature in features
        if abs(row.get(f"{feature}__z", 0)) >= threshold
    }
    if not deviations:
        return "Typical smallholder"

    ranked = sorted(deviations.items(), key=lambda kv: abs(kv[1]), reverse=True)[:2]

    words = {
        "land_total_area": ("Land-rich", "Land-poor"),
        "livestock_tlu": ("Livestock-holding", "Livestock-poor"),
        "crop_diversity": ("Diversified-cropping", "Single-crop"),
        "land_any_irrigated": ("Irrigated", "Rain-dependent"),
        "geo_dist_market": ("Market-isolated", "Market-connected"),
        "geo_rain_anomaly_2019": ("Wetter-than-normal", "Drought-affected"),
        "dependency_ratio": ("High-dependency", "Low-dependency"),
        "cons_per_adult_eq": ("Better-off", "Low-consumption"),
        "diet_n_groups": ("Diverse-diet", "Narrow-diet"),
        "econ_n_asset_types": ("Asset-holding", "Low-asset"),
    }

    parts = []
    for feature, z in ranked:
        high, low = words.get(feature, (feature, f"low {feature}"))
        parts.append(high if z > 0 else low)
    return " / ".join(parts)


def agreement(labels_a, labels_b) -> float:
    """Adjusted Rand index between two clusterings of the same households."""
    from sklearn.metrics import adjusted_rand_score

    return float(adjusted_rand_score(labels_a, labels_b))

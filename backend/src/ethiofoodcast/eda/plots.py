"""Matplotlib figures for the exploratory stage.

All figures are written to ``reports/figures``. Each states the sample it was
computed on, because the project has three (all Wave 4 households, the wide
matched sample, and the agricultural modelling sample) and mixing them up
would quietly misdescribe the data.
"""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")  # no display in a pipeline run

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.cluster.hierarchy import leaves_list, linkage
from scipy.spatial.distance import squareform

from ..config import paths

FIGSIZE = (10, 6)
DPI = 130
POSITIVE = "#c0392b"
NEUTRAL = "#2c7fb8"


def _save(fig, name: str) -> str:
    path = paths.FIGURES_DIR / f"{name}.png"
    fig.tight_layout()
    fig.savefig(path, dpi=DPI, bbox_inches="tight")
    plt.close(fig)
    return name


def missingness(frame: pd.DataFrame, features: list[str], top: int = 30) -> str:
    rates = (100 * frame[features].isna().mean()).sort_values(ascending=False).head(top)
    rates = rates[rates > 0]

    fig, ax = plt.subplots(figsize=(10, max(4, 0.28 * len(rates))))
    ax.barh(rates.index[::-1], rates.to_numpy()[::-1], color=NEUTRAL)
    ax.set_xlabel("% missing")
    ax.set_title("Missingness by feature (agricultural modelling sample)")
    ax.axvline(40, color=POSITIVE, ls="--", lw=1, label="40% drop threshold")
    ax.legend()
    return _save(fig, "01_missingness")


def target_balance(frame: pd.DataFrame, target: str) -> str:
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))

    counts = frame[target].value_counts().sort_index()
    axes[0].bar(["Food secure", "Food insecure"], counts.to_numpy(),
                color=[NEUTRAL, POSITIVE])
    axes[0].set_title(f"Target balance (n={int(counts.sum()):,})")
    for i, v in enumerate(counts.to_numpy()):
        axes[0].text(i, v, f"{v:,}\n{100*v/counts.sum():.1f}%", ha="center", va="bottom")

    by_region = frame.groupby("w4_region")[target].agg(["mean", "size"])
    by_region = by_region[by_region["size"] >= 20].sort_values("mean")
    axes[1].barh(by_region.index.astype(str), 100 * by_region["mean"], color=NEUTRAL)
    axes[1].set_xlabel("% food insecure")
    axes[1].set_title("By region (n>=20 only)")
    for i, (_, row) in enumerate(by_region.iterrows()):
        axes[1].text(100 * row["mean"], i, f"  n={int(row['size'])}", va="center", fontsize=8)

    return _save(fig, "02_target_balance")


def distributions(frame: pd.DataFrame, columns: list[str]) -> str:
    columns = [c for c in columns if c in frame.columns][:12]
    fig, axes = plt.subplots(3, 4, figsize=(16, 10))

    for ax, column in zip(axes.ravel(), columns):
        values = pd.to_numeric(frame[column], errors="coerce").dropna()
        ax.hist(values, bins=40, color=NEUTRAL, edgecolor="white", linewidth=0.3)
        ax.set_title(column, fontsize=9)
        ax.tick_params(labelsize=7)

    for ax in axes.ravel()[len(columns):]:
        ax.axis("off")

    fig.suptitle("Key feature distributions (agricultural sample)", y=1.01)
    return _save(fig, "03_distributions")


def correlation_heatmap(frame: pd.DataFrame, columns: list[str], top: int = 35) -> str:
    """Spearman, hierarchically ordered so correlated blocks are visible.

    Spearman rather than Pearson because the agricultural quantities are
    heavily right-skewed, where a rank correlation is the honest measure.
    """
    numeric = frame[columns].apply(pd.to_numeric, errors="coerce")
    numeric = numeric.loc[:, numeric.std() > 0].dropna(axis=1, how="all")
    numeric = numeric.iloc[:, :top] if numeric.shape[1] > top else numeric

    corr = numeric.corr(method="spearman").fillna(0)
    distance = 1 - corr.abs()
    np.fill_diagonal(distance.values, 0)
    order = leaves_list(linkage(squareform(distance.values, checks=False), "average"))
    corr = corr.iloc[order, order]

    fig, ax = plt.subplots(figsize=(12, 10))
    im = ax.imshow(corr, cmap="RdBu_r", vmin=-1, vmax=1)
    ax.set_xticks(range(len(corr)))
    ax.set_xticklabels(corr.columns, rotation=90, fontsize=7)
    ax.set_yticks(range(len(corr)))
    ax.set_yticklabels(corr.index, fontsize=7)
    ax.set_title("Spearman correlation, hierarchically clustered")
    fig.colorbar(im, ax=ax, shrink=0.7)
    return _save(fig, "04_correlation")


def _wilson(successes: int, total: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson interval -- honest at the small cell counts these plots produce."""
    if total == 0:
        return 0.0, 0.0
    p = successes / total
    denom = 1 + z**2 / total
    centre = (p + z**2 / (2 * total)) / denom
    margin = z * np.sqrt(p * (1 - p) / total + z**2 / (4 * total**2)) / denom
    return max(0.0, centre - margin), min(1.0, centre + margin)


def rate_by_decile(frame: pd.DataFrame, column: str, target: str, ax) -> None:
    values = pd.to_numeric(frame[column], errors="coerce")
    valid = values.notna() & frame[target].notna()
    if valid.sum() < 50 or values[valid].nunique() < 4:
        ax.axis("off")
        return

    bins = pd.qcut(values[valid], 5, duplicates="drop")
    grouped = frame.loc[valid].groupby(bins, observed=True)[target].agg(["sum", "size"])

    centres, lows, highs = [], [], []
    for _, row in grouped.iterrows():
        low, high = _wilson(int(row["sum"]), int(row["size"]))
        centres.append(100 * row["sum"] / row["size"])
        lows.append(100 * low)
        highs.append(100 * high)

    x = range(len(grouped))
    ax.errorbar(
        x, centres,
        yerr=[np.array(centres) - lows, np.array(highs) - np.array(centres)],
        fmt="o-", color=POSITIVE, capsize=3, markersize=4,
    )
    ax.set_title(column, fontsize=9)
    ax.set_xticks(list(x))
    ax.set_xticklabels([f"Q{i+1}" for i in x], fontsize=7)
    ax.tick_params(labelsize=7)


def drivers(frame: pd.DataFrame, columns: list[str], target: str) -> str:
    columns = [c for c in columns if c in frame.columns][:12]
    fig, axes = plt.subplots(3, 4, figsize=(16, 10))

    for ax, column in zip(axes.ravel(), columns):
        rate_by_decile(frame, column, target, ax)
    for ax in axes.ravel()[len(columns):]:
        ax.axis("off")

    fig.suptitle(
        "Food-insecurity rate by feature quintile, with 95% Wilson intervals", y=1.01
    )
    return _save(fig, "05_drivers")


def mutual_information(scores: pd.Series, top: int = 25) -> str:
    top_scores = scores.sort_values(ascending=False).head(top)

    fig, ax = plt.subplots(figsize=(10, max(4, 0.3 * len(top_scores))))
    ax.barh(top_scores.index[::-1], top_scores.to_numpy()[::-1], color=NEUTRAL)
    ax.set_xlabel("mutual information with the target")
    ax.set_title("Top features by mutual information (captures non-monotone signal)")
    return _save(fig, "06_mutual_information")

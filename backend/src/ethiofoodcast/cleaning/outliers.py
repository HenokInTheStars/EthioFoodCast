"""Outlier handling for continuous agricultural quantities.

LSMS unit conversions produce implausible values — 500-hectare smallholders,
harvests of millions of kilograms — that would dominate any mean or scaler.
Winsorising caps them at a percentile rather than deleting the household,
which would lose every other answer that household gave.
"""

from __future__ import annotations

import pandas as pd


def winsorise(
    series: pd.Series, lower_pct: float = 0.01, upper_pct: float = 0.99
) -> pd.Series:
    """Clip to the given percentiles, ignoring nulls when computing them."""
    numeric = pd.to_numeric(series, errors="coerce")
    if numeric.notna().sum() < 10:
        return numeric

    low, high = numeric.quantile([lower_pct, upper_pct])
    return numeric.clip(lower=low, upper=high)


def winsorise_frame(
    frame: pd.DataFrame,
    columns: list[str],
    lower_pct: float = 0.01,
    upper_pct: float = 0.99,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Winsorise `columns`; return the frame and a report of what was clipped."""
    out = frame.copy()
    rows = []

    for column in columns:
        if column not in out.columns:
            continue
        before = pd.to_numeric(out[column], errors="coerce")
        after = winsorise(before, lower_pct, upper_pct)
        n_clipped = int((before != after).sum())

        out[column] = after
        rows.append(
            {
                "column": column,
                "n_clipped": n_clipped,
                "pct_clipped": round(100 * n_clipped / max(len(out), 1), 2),
                "max_before": before.max(),
                "max_after": after.max(),
            }
        )

    return out, pd.DataFrame(rows)

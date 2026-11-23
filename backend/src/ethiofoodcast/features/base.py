"""Shared helpers for the feature builders.

Every builder returns **one row per household_id**. Survey modules arrive at
parcel, field, crop or animal granularity, so aggregation happens here rather
than being re-invented nine times.
"""

from __future__ import annotations

import pandas as pd

from ..cleaning.codebook import decode_labelled, looks_labelled, yes_no_to_binary


def yes_no(series: pd.Series) -> pd.Series:
    """Coerce a yes/no column to 1/0 whichever wave shape it arrived in."""
    if looks_labelled(series):
        series = decode_labelled(series)
    return yes_no_to_binary(series)


def code_of(series: pd.Series) -> pd.Series:
    """Numeric code of a categorical column, from either wave shape."""
    if looks_labelled(series):
        return decode_labelled(series)
    return pd.to_numeric(series, errors="coerce")


def any_yes(frame: pd.DataFrame, column: str) -> pd.Series:
    """Household-level 'reported yes at least once' over a long-format module."""
    flags = yes_no(frame[column])
    return flags.groupby(frame["household_id"]).max()


def sum_by_household(frame: pd.DataFrame, column: str) -> pd.Series:
    values = pd.to_numeric(frame[column], errors="coerce")
    return values.groupby(frame["household_id"]).sum(min_count=1)


def mean_by_household(frame: pd.DataFrame, column: str) -> pd.Series:
    values = pd.to_numeric(frame[column], errors="coerce")
    return values.groupby(frame["household_id"]).mean()


def safe_ratio(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    """Element-wise ratio with zero and missing denominators returning NA.

    Division by zero would otherwise produce inf, which survives every null
    check and then poisons scalers and tree splits alike.
    """
    denom = denominator.replace(0, pd.NA)
    return (numerator / denom).astype("Float64")


def frame_from(series_map: dict[str, pd.Series], index_name: str = "household_id"):
    """Assemble named per-household series into one frame."""
    out = pd.DataFrame(series_map)
    out.index.name = index_name
    return out.reset_index()

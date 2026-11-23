"""Decoding survey answers to numeric codes.

The two waves arrive in different shapes, which is the central problem this
module solves:

  * **Wave 4** (CSV) stores *label strings*: ``'1. YES'``, ``'2. NO'``.
  * **Wave 5** (converted from SPSS) stores *numeric codes*: ``1.0``, ``2.0``,
    with the labels held separately in the codebook sidecars.

Both are reduced to the same numeric codes here, so no downstream stage has to
know which wave a column came from.

A useful consequence of the Wave 4 format: because the label text travels with
the value, "don't know" and "refused" answers can be identified from the label
itself rather than by assuming 98/99 are always sentinels. For Wave 5 the same
judgement is made from the sidecar. Neither relies on a hardcoded magic number.
"""

from __future__ import annotations

import re

import pandas as pd

# 'don't know' / 'refused' style answers. These are non-responses, not
# categories: treating them as data would invent a level that means nothing.
MISSING_LABEL_PATTERNS = (
    r"do\s*n.?t\s*know",
    r"\bdk\b",
    r"refus",
    r"no\s+response",
    r"not\s+stated",
    r"unknown",
)
_MISSING_LABEL = re.compile("|".join(MISSING_LABEL_PATTERNS), re.IGNORECASE)

# '1. YES' -> 1 . Tolerant of the damaged Ethiopic byte sequences present in
# some Wave 4 label text, because only the leading code is read.
_LABELLED = re.compile(r"^\s*(-?\d+)\s*\.\s*(.*)$", re.DOTALL)


def is_missing_label(label: object) -> bool:
    """True if a label means 'no answer' rather than naming a category."""
    return bool(label is not None and _MISSING_LABEL.search(str(label)))


def split_labelled(value: object) -> tuple[float | None, str | None]:
    """Split ``'1. YES'`` into ``(1.0, 'YES')``; pass numbers through."""
    if value is None or pd.isna(value):
        return None, None

    if isinstance(value, (int, float)):
        return float(value), None

    match = _LABELLED.match(str(value))
    if match is None:
        return None, str(value)

    return float(match.group(1)), match.group(2).strip()


def looks_labelled(series: pd.Series, sample: int = 200) -> bool:
    """True if the column holds ``'N. Label'`` strings rather than numbers."""
    if pd.api.types.is_numeric_dtype(series):
        return False

    values = series.dropna().astype(str).head(sample)
    if values.empty:
        return False

    return bool(values.str.match(_LABELLED).mean() > 0.8)


def decode_labelled(series: pd.Series) -> pd.Series:
    """Return the numeric code, with 'don't know' / 'refused' set to missing."""
    codes, labels = [], []
    for value in series:
        code, label = split_labelled(value)
        codes.append(code)
        labels.append(label)

    decoded = pd.Series(codes, index=series.index, dtype="Float64")
    non_response = pd.Series(
        [is_missing_label(label) for label in labels], index=series.index
    )
    return decoded.mask(non_response)


def missing_codes_from_sidecar(values: pd.DataFrame) -> dict[str, set[float]]:
    """Codes meaning 'no answer', read from a Wave 5 value-label sidecar.

    Wave 5's .sav files declare no missing ranges, so the labels are the only
    reliable source: ``98. Don't Know`` and ``99. Refused`` are identified as
    non-responses because of what they say, not because of what they equal.
    """
    if values.empty:
        return {}

    flagged = values[values["label"].map(is_missing_label)]
    return {
        column: set(group["code"].astype(float))
        for column, group in flagged.groupby("column")
    }


def apply_missing_codes(
    frame: pd.DataFrame, missing_codes: dict[str, set[float]]
) -> pd.DataFrame:
    """Blank out non-response codes column by column."""
    out = frame.copy()
    for column, codes in missing_codes.items():
        if column in out.columns:
            out[column] = out[column].mask(out[column].isin(codes))
    return out


def decode_frame(
    frame: pd.DataFrame, *, skip: tuple[str, ...] = ()
) -> tuple[pd.DataFrame, list[str]]:
    """Decode every labelled column. Returns the frame and the columns changed."""
    out = frame.copy()
    decoded: list[str] = []

    for column in out.columns:
        if column in skip:
            continue
        if looks_labelled(out[column]):
            out[column] = decode_labelled(out[column])
            decoded.append(column)

    return out, decoded


def yes_no_to_binary(series: pd.Series) -> pd.Series:
    """Map the survey's 1=YES / 2=NO coding to 1/0, leaving missing as missing.

    Anything outside {1, 2} becomes missing rather than being coerced, so an
    unexpected code surfaces as a null in the report instead of silently
    counting as a 'no'.
    """
    numeric = pd.to_numeric(series, errors="coerce")
    return numeric.map({1: 1, 2: 0}).astype("Float64")

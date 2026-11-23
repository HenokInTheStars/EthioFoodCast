"""Identifier handling.

Ethiopian household ids carry leading zeros ('010101088800910007'). Two things
destroy them:

  * ``pyreadstat.read_sav`` returns numeric-looking ids as floats, so the id
    becomes ``1.0101008880091e+17``;
  * ``pandas.read_csv`` re-infers a string column as numeric unless told not to.

Either one silently breaks the Wave 4 <-> Wave 5 join, which is the spine of
the whole project. Every read and write goes through this module.
"""

from __future__ import annotations

import re

import pandas as pd

from ..config.constants import HOUSEHOLD_ID_LENGTH, ID_COLUMNS

_TRAILING_DOT_ZERO = re.compile(r"\d+\.0")
_SCIENTIFIC = re.compile(r"[eE][+-]?\d")


def _repair_float_id(value: object, width: int) -> str | None:
    """Recover a zero-padded id from whatever form it survived in.

    Handles the float case ('1.0101e+17'), the already-clean string case, and
    the int case, returning None for genuine missings.
    """
    if value is None or pd.isna(value):
        return None

    text = str(value).strip()
    if text == "" or text.lower() in {"nan", "none", "<na>", "nat"}:
        return None

    if _TRAILING_DOT_ZERO.fullmatch(text):
        # '10101088800910007.0' -> strip textually. Going via float() would
        # round-trip an 17-digit integer through a 53-bit mantissa and quietly
        # change the last digits.
        text = text[:-2]
    elif _SCIENTIFIC.search(text):
        # Already lossy by the time it reached us, but recover what we can.
        try:
            text = f"{int(float(text)):d}"
        except (ValueError, OverflowError):
            return text

    return text.zfill(width) if width else text


def normalise_id_column(series: pd.Series) -> pd.Series:
    """Return `series` as zero-padded strings of uniform width.

    Padding only applies to columns that arrived as numbers, where the leading
    zeros genuinely were destroyed; the width is then the longest repaired
    value, the only length that was never truncated. String columns are left
    alone, because variable width can be real -- see the comment below.
    """
    repaired = [_repair_float_id(v, 0) for v in series]

    # Only pad when the source was numeric, i.e. the zeros really were lost.
    # A column that arrived as strings is already correct and may legitimately
    # hold variable-width values: Wave 4 `holder_id` is 20 characters for 2,938
    # holders and 21 for one (a 3-digit holder suffix). Padding everything to
    # the longest value silently prepended a zero to all 2,938.
    if pd.api.types.is_numeric_dtype(series):
        lengths = [len(v) for v in repaired if v is not None]
        width = max(lengths) if lengths else 0
    else:
        width = 0

    return pd.Series(
        [None if v is None else v.zfill(width) for v in repaired],
        index=series.index,
        dtype="string",
    )


def normalise_ids(df: pd.DataFrame) -> pd.DataFrame:
    """Normalise every known id column present in `df`. Returns a new frame."""
    out = df.copy()
    for column in ID_COLUMNS:
        if column in out.columns:
            out[column] = normalise_id_column(out[column])
    return out


def household_id_from_holder(holder_ids: pd.Series) -> pd.Series:
    """Derive ``household_id`` as the leading 18 characters of ``holder_id``.

    Agricultural modules key on ``holder_id``; household modules key on
    ``household_id``. Taking a prefix rather than stripping a suffix matters:
    the holder suffix is 2 digits for 2,938 of the 2,939 Wave 4 holders and 3
    for one, so ``str[:-2]`` would return a 19-character id for that household
    and silently fail to match.
    """
    return holder_ids.astype("string").str[:HOUSEHOLD_ID_LENGTH]


def assert_ids_intact(
    df: pd.DataFrame, column: str = "household_id", *, uniform_width: bool = True
) -> None:
    """Raise if an id column shows signs of numeric mangling.

    Called after every load and before every write. Cheap, and it catches the
    failure at the point it happens rather than as an unexplained drop in the
    matched sample twenty steps later.

    ``uniform_width=False`` for columns whose width is legitimately variable,
    such as ``holder_id`` (20 or 21 characters).
    """
    if column not in df.columns:
        raise KeyError(f"{column!r} not found; columns are {list(df.columns)[:12]}")

    values = df[column].dropna().astype(str)
    if values.empty:
        raise ValueError(f"{column!r} is entirely missing")

    # Target float mangling specifically, not any non-digit character. Real ESS
    # ids are not always pure digits: 2 of the 6,770 Wave 4 households carry a
    # literal '.a' suffix (e.g. '0306100101001100.a'), a survey-office
    # convention for a split household. Those are valid and must pass.
    scientific = values[values.str.contains(r"[eE][+-]?\d", regex=True, na=False)]
    if not scientific.empty:
        raise ValueError(
            f"{column!r} contains scientific-notation ids "
            f"(e.g. {scientific.iloc[0]!r}) — leading zeros were destroyed"
        )

    float_repr = values[values.str.endswith(".0")]
    if not float_repr.empty:
        raise ValueError(
            f"{column!r} contains float-formatted ids "
            f"(e.g. {float_repr.iloc[0]!r}) — read as numeric instead of string"
        )

    widths = values.str.len().unique()
    if uniform_width and len(widths) > 1:
        raise ValueError(
            f"{column!r} has inconsistent id widths {sorted(widths)} — "
            "some rows were likely stripped of leading zeros"
        )


def assert_one_row_per(df: pd.DataFrame, column: str = "household_id") -> None:
    """Raise if `column` is not unique. Guards every join against row blow-up."""
    duplicated = int(df[column].duplicated().sum())
    if duplicated:
        raise ValueError(
            f"expected one row per {column}, found {duplicated} duplicate(s) "
            f"in {len(df)} rows"
        )

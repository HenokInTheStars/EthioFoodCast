"""Privacy rules, enforced here rather than trusted to the frontend.

Three protections, each answering something the survey licence or the ethics
of the project requires:

* **Surrogate identifiers.** A leaked export must not re-identify a surveyed
  household. Real ids never leave this module.
* **No coordinates, at any aggregation.** `lat_mod`/`lon_mod` are already
  displacement-modified and were excluded as predictors for the same reason.
* **Small-cell suppression.** A regional or cluster cell built from a handful
  of households can expose those households, and is statistically worthless
  besides. Suppression is made *visible* so a map is not silently incomplete.
"""

from __future__ import annotations

import hashlib

import pandas as pd

MIN_CELL_SIZE = 25
FORBIDDEN_COLUMNS = ("lat_mod", "lon_mod", "household_id", "ea_id", "holder_id")

CAVEATS = [
    "Wave 5 excludes Tigray; Afar and Benishangul retained only 35% and 57% of "
    "agricultural households, so the most vulnerable regions are under-represented.",
    "Predictors are from 2018/19 and outcomes from 2021/22; the gap spans "
    "COVID-19, conflict and severe inflation that no predictor observes.",
    "Risk is statistical, not certain, and must not be the sole basis for "
    "determining assistance.",
    "Explanations show what the model uses, not what causes food insecurity.",
    "The agricultural sample is entirely rural; nothing here applies to urban "
    "households.",
]


def surrogate_id(household_id: str, salt: str = "ethiofoodcast") -> str:
    """Stable opaque key. The mapping back is never written to artifacts."""
    digest = hashlib.sha256(f"{salt}:{household_id}".encode()).hexdigest()
    return f"H{digest[:12]}"


def anonymise(frame: pd.DataFrame) -> pd.DataFrame:
    """Replace identifiers with surrogates and drop everything forbidden."""
    out = frame.copy()

    if "household_id" in out.columns:
        out.insert(0, "surrogate_id", out["household_id"].map(surrogate_id))

    for column in FORBIDDEN_COLUMNS:
        if column in out.columns:
            out = out.drop(columns=column)

    return out


def suppress_small_cells(
    frame: pd.DataFrame, count_column: str = "n", minimum: int = MIN_CELL_SIZE
) -> pd.DataFrame:
    """Blank out the values of cells below `minimum`, keeping the row visible.

    Dropping the row entirely would make a map look complete when it is not.
    The row stays, marked suppressed, so the gap is legible.
    """
    out = frame.copy()
    small = out[count_column] < minimum

    out["suppressed"] = small
    value_columns = [
        c for c in out.columns
        if c not in (count_column, "suppressed") and pd.api.types.is_numeric_dtype(out[c])
    ]
    out.loc[small, value_columns] = pd.NA

    return out


def assert_safe(frame: pd.DataFrame) -> None:
    """Raise if an export still carries anything identifying."""
    leaked = [c for c in FORBIDDEN_COLUMNS if c in frame.columns]
    if leaked:
        raise ValueError(f"export still contains identifying columns: {leaked}")

    coordinates = [c for c in frame.columns if c.startswith(("lat", "lon"))]
    if coordinates:
        raise ValueError(f"export contains coordinate columns: {coordinates}")

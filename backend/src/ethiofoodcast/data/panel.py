"""Wave 4 <-> Wave 5 panel matching (Stage 1).

Builds the modelling spine: one row per household, carrying Wave 4 context,
agricultural status, and whether a Wave 5 food-security outcome exists.

Two rules are enforced here because getting either wrong biases the sample in
a way no later stage can detect:

1. **Inclusion.** A household qualifies on *Wave 4 agriculture + a Wave 5 FIES
   record*, NOT on Wave 5 agricultural participation. Filtering on the latter
   would drop households that stopped farming between waves, and leaving
   agriculture is plausibly a consequence of the distress being predicted —
   a post-treatment variable. Selecting on it biases the sample toward
   households that coped.

2. **Attrition is reported, not silently absorbed.** Every unmatched household
   is counted and cross-tabbed, because non-random attrition is the main way
   this design fails quietly.
"""

from __future__ import annotations

import pandas as pd

from ..config import columns as cols
from ..config.constants import (
    EA_COLUMN,
    REGION_COLUMN,
    RURAL_URBAN_COLUMN,
    W4_WEIGHT,
    W5_WEIGHT,
)
from .ids import (
    assert_ids_intact,
    assert_one_row_per,
    household_id_from_holder,
)
from .loaders import read_module


def _w4_household_universe() -> pd.DataFrame:
    """Wave 4 households with region, rural/urban, EA and design weight."""
    cover = read_module(4, cols.W4["cover_hh"])
    assert_ids_intact(cover)
    assert_one_row_per(cover)

    keep = ["household_id", EA_COLUMN, REGION_COLUMN, RURAL_URBAN_COLUMN, W4_WEIGHT]
    present = [c for c in keep if c in cover.columns]
    return cover[present].rename(
        columns={
            REGION_COLUMN: "w4_region",
            RURAL_URBAN_COLUMN: "w4_rural_urban",
            W4_WEIGHT: "w4_weight",
        }
    )


def _w4_agricultural_universe() -> pd.DataFrame:
    """Wave 4 agricultural households, derived from holder ids.

    The post-planting cover file keys on ``holder_id``; a household may have
    more than one holder, so holders are collapsed to households and the count
    retained as a feature.
    """
    cover = read_module(4, cols.W4["cover_pp"])
    # holder_id width is legitimately 20 or 21 characters, so the uniform-width
    # rule does not apply to it.
    assert_ids_intact(cover, "holder_id", uniform_width=False)

    if "household_id" not in cover.columns:
        cover["household_id"] = household_id_from_holder(cover["holder_id"])

    holders = (
        cover.groupby("household_id", as_index=False)
        .agg(n_holders=("holder_id", "nunique"))
        .assign(is_agricultural=1)
    )
    return holders


def _w5_outcome_universe() -> pd.DataFrame:
    """Wave 5 households carrying a FIES module record."""
    fies = read_module(5, cols.W5["food_security"])
    assert_ids_intact(fies)
    assert_one_row_per(fies)

    keep = ["household_id", EA_COLUMN, REGION_COLUMN, RURAL_URBAN_COLUMN, W5_WEIGHT]
    present = [c for c in keep if c in fies.columns]

    item_cols = [c for c in cols.FIES_ITEMS if c in fies.columns]
    frame = fies[present + item_cols].rename(
        columns={
            REGION_COLUMN: "w5_region",
            RURAL_URBAN_COLUMN: "w5_rural_urban",
            W5_WEIGHT: "w5_weight",
            EA_COLUMN: "w5_ea_id",
        }
    )
    # A record exists but may be entirely blank; the target stage decides
    # usability, this only records presence.
    frame["has_w5_fies_record"] = 1
    frame["n_fies_answered"] = frame[item_cols].notna().sum(axis=1)
    return frame


def build_panel() -> pd.DataFrame:
    """Return the matched W4 -> W5 spine, one row per Wave 4 household."""
    w4 = _w4_household_universe()
    agricultural = _w4_agricultural_universe()
    w5 = _w5_outcome_universe()

    panel = w4.merge(agricultural, on="household_id", how="left")
    panel["is_agricultural"] = panel["is_agricultural"].fillna(0).astype(int)
    panel["n_holders"] = panel["n_holders"].fillna(0).astype(int)

    before = len(panel)
    panel = panel.merge(w5, on="household_id", how="left")
    assert len(panel) == before, "Wave 5 join multiplied rows"

    panel["has_w5_fies_record"] = panel["has_w5_fies_record"].fillna(0).astype(int)
    panel["n_fies_answered"] = panel["n_fies_answered"].fillna(0).astype(int)
    panel["matched"] = panel["has_w5_fies_record"]

    # The modelling sample. Note what is NOT required: Wave 5 agricultural
    # participation. See the module docstring.
    panel["in_modelling_sample"] = (
        (panel["is_agricultural"] == 1) & (panel["matched"] == 1)
    ).astype(int)

    # The wide training sample: any matched household, farming or not.
    panel["in_wide_sample"] = panel["matched"]

    assert_one_row_per(panel)
    return panel


def orphan_agricultural_households() -> pd.DataFrame:
    """Agricultural holders whose household_id is absent from the W4 cover file.

    Roughly 4% of the agricultural sample. The plan requires these be reported
    rather than silently dropped, since an id-format mismatch would be a very
    different problem from genuine absence.
    """
    cover_hh = read_module(4, cols.W4["cover_hh"])[["household_id"]]
    agricultural = _w4_agricultural_universe()
    orphans = agricultural[~agricultural["household_id"].isin(cover_hh["household_id"])]
    return orphans


def attrition_report(panel: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Matched vs unmatched counts, cross-tabbed by the dimensions that matter.

    Non-random attrition biases the training sample. These tables are how it
    gets detected and reported rather than assumed away.
    """
    tables: dict[str, pd.DataFrame] = {}

    def crosstab(column: str, label: str, subset: pd.DataFrame) -> None:
        if column not in subset.columns:
            return
        table = pd.crosstab(subset[column], subset["matched"], dropna=False)
        table.columns = [f"unmatched_{c}" if c == 0 else f"matched_{c}" for c in table.columns]
        table = table.rename(columns={"unmatched_0": "unmatched", "matched_1": "matched"})
        for col in ("matched", "unmatched"):
            if col not in table.columns:
                table[col] = 0
        table["total"] = table["matched"] + table["unmatched"]
        table["retention_pct"] = (
            100 * table["matched"] / table["total"].replace(0, pd.NA)
        ).round(1)
        tables[label] = table.reset_index()

    crosstab("w4_region", "by_region_all", panel)
    crosstab("w4_rural_urban", "by_rural_urban_all", panel)
    crosstab("is_agricultural", "by_agricultural_status", panel)

    agricultural = panel[panel["is_agricultural"] == 1]
    crosstab("w4_region", "by_region_agricultural", agricultural)
    crosstab("w4_rural_urban", "by_rural_urban_agricultural", agricultural)

    tables["summary"] = pd.DataFrame(
        [
            {"metric": "w4_households", "value": len(panel)},
            {"metric": "w4_agricultural", "value": int(panel["is_agricultural"].sum())},
            {"metric": "w5_matched", "value": int(panel["matched"].sum())},
            {
                "metric": "wide_sample",
                "value": int(panel["in_wide_sample"].sum()),
            },
            {
                "metric": "modelling_sample_agricultural",
                "value": int(panel["in_modelling_sample"].sum()),
            },
            {
                "metric": "retention_pct_overall",
                "value": round(100 * panel["matched"].mean(), 1),
            },
            {
                "metric": "retention_pct_agricultural",
                "value": round(
                    100 * panel.loc[panel["is_agricultural"] == 1, "matched"].mean(), 1
                ),
            },
        ]
    )
    return tables

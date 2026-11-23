"""Join every feature block onto the panel spine: one row per household.

This is where the three-state missingness policy is applied. Agricultural
blocks do not apply to non-farming households, so their absence is encoded as
``has_<block>_data = 0`` with a neutral fill, rather than as a null that would
be confused with a farmer who declined to answer.

Two feature sets come out of here:

  * **Set A** -- everything, including Wave 4 food-insecurity history.
  * **Set B** -- Set A minus that history, to test whether agricultural and
    household conditions predict risk on their own.
"""

from __future__ import annotations

import pandas as pd

from ..cleaning.missing import encode_structural
from ..config import paths
from . import (
    crops,
    diet,
    economy,
    geo,
    household,
    inputs,
    land,
    livestock,
    prior_fi,
    shocks,
)

# Blocks whose questions are only put to agricultural households.
AGRICULTURAL_BLOCKS = ("land", "crops", "inputs", "livestock")

# Blocks asked of every household.
UNIVERSAL_BLOCKS = ("household", "prior_fi", "economy", "shocks", "geo", "diet")

BUILDERS = {
    "household": household,
    "prior_fi": prior_fi,
    "land": land,
    "crops": crops,
    "inputs": inputs,
    "livestock": livestock,
    "economy": economy,
    "shocks": shocks,
    "geo": geo,
    "diet": diet,
}

SPINE_COLUMNS = [
    "household_id", "ea_id", "w4_region", "w4_rural_urban", "w4_weight",
    "w5_weight", "is_agricultural", "n_holders", "matched",
    "in_wide_sample", "in_modelling_sample",
]


def build_blocks() -> dict[str, pd.DataFrame]:
    return {name: module.build() for name, module in BUILDERS.items()}


def assemble(spine: pd.DataFrame | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Return the assembled feature table and a per-block provenance report."""
    if spine is None:
        spine = pd.read_parquet(paths.INTERIM_DIR / "panel_spine.parquet")

    frame = spine[[c for c in SPINE_COLUMNS if c in spine.columns]].copy()
    blocks = build_blocks()
    rows = []

    for name, block in blocks.items():
        before = len(frame)
        feature_columns = [c for c in block.columns if c != "household_id"]

        frame = frame.merge(block, on="household_id", how="left")
        if len(frame) != before:
            raise ValueError(f"block {name!r} multiplied rows: {before} -> {len(frame)}")

        if name in AGRICULTURAL_BLOCKS:
            # "Applies" means the household actually appears in this block, not
            # merely that it farms. 576 agricultural households report no crops
            # at all -- livestock keepers rather than non-responders -- so
            # has_crops_data = 0 is the honest encoding for them, and it is a
            # genuinely informative feature. Within the households a block did
            # reach, a null is real non-response and gets its own flag.
            applies = frame["household_id"].isin(block["household_id"])
            frame = encode_structural(frame, feature_columns, applies, block=name)

        rows.append(
            {
                "block": name,
                "n_features": len(feature_columns),
                "households_covered": int(block["household_id"].nunique()),
                "applies_to": "agricultural" if name in AGRICULTURAL_BLOCKS else "all",
            }
        )

    frame = crops.add_yield(frame)

    # Derived cross-block ratios, only meaningful once the blocks are joined.
    if {"land_total_area", "hh_size"} <= set(frame.columns):
        frame["land_area_per_person"] = (
            frame["land_total_area"] / frame["hh_size"].replace(0, pd.NA)
        ).astype("Float64")
    if {"livestock_tlu", "hh_size"} <= set(frame.columns):
        frame["livestock_tlu_per_person"] = (
            frame["livestock_tlu"] / frame["hh_size"].replace(0, pd.NA)
        ).astype("Float64")

    if frame["household_id"].duplicated().any():
        raise ValueError("assembled table is not one row per household")

    return frame, pd.DataFrame(rows)


def feature_columns(frame: pd.DataFrame, *, include_prior_fi: bool = True) -> list[str]:
    """Model-ready predictor columns.

    Survey weights, panel bookkeeping and identifiers are never predictors, and
    `w4_rural_urban` is dropped because it is constant on the agricultural
    sample -- every agricultural household is rural.
    """
    never = {
        # identifiers and panel bookkeeping
        "household_id", "ea_id", "matched",
        "in_wide_sample", "in_modelling_sample",
        # survey design weights describe the sampling frame, not the household
        "w4_weight", "w5_weight",
        # constant on the agricultural sample: every agricultural household is
        # rural, so this carries no variance where it matters
        "w4_rural_urban",
        # the outcome and its variants -- predicting the target from itself
        "food_insecure", "fies_any", "fies_raw_score", "risk_band",
        "n_items_answered", "target_resolved",
    }
    never |= {c for c in frame.columns if c.startswith("item_s8q")}
    columns = [c for c in frame.columns if c not in never]

    if not include_prior_fi:
        columns = [c for c in columns if not c.startswith(prior_fi.PREFIX)]

    return columns

"""Crop portfolio, damage and harvest outcomes.

Sources: ``sect4_pp_w4`` (planting, 16,913 crop-field rows) and
``sect9_ph_w4`` (post-harvest, 16,205 rows).

Confirmed codings: ``s4q01a`` crop name, ``s4q02`` pure/mixed stand,
``s4q05`` pesticide, ``s4q07`` fungicide, ``s4q08`` crop damaged,
``s4q11`` seed type (1 = Traditional, 2-4 = improved variants),
``s9q06`` harvest in kilograms, ``s9q10`` area harvested < area planted,
``s9q11`` percentage of planted area harvested, ``s9q12a-f`` the reasons.
"""

from __future__ import annotations

import pandas as pd

from ..config import columns as cols
from ..data.loaders import read_module
from .base import code_of, frame_from, safe_ratio, yes_no

TRADITIONAL_SEED = 1
SHORTFALL_REASONS = {
    "s9q12a": "drought",
    "s9q12b": "rains",
    "s9q12c": "fire",
    "s9q12d": "insects",
    "s9q12e": "animals",
    "s9q12f": "theft",
}


def build() -> pd.DataFrame:
    planting = read_module(4, cols.W4["pp_crops"])
    by_household = planting["household_id"]

    series = {
        # Crop diversity: a household growing one crop carries all its risk in
        # that crop, whatever the total area.
        "crop_diversity": planting.groupby("household_id")["s4q01a"].nunique(),
        "crop_n_plantings": by_household.value_counts().sort_index(),
    }

    if "s4q08" in planting.columns:
        damaged = yes_no(planting["s4q08"])
        series["crop_any_damage"] = damaged.groupby(by_household).max()
        series["crop_damage_rate"] = damaged.groupby(by_household).mean()

    for column, name in (("s4q05", "pesticide"), ("s4q07", "fungicide")):
        if column in planting.columns:
            series[f"crop_any_{name}"] = yes_no(planting[column]).groupby(by_household).max()

    if "s4q11" in planting.columns:
        improved = code_of(planting["s4q11"]).ne(TRADITIONAL_SEED).astype("Float64")
        series["crop_any_improved_seed"] = improved.groupby(by_household).max()
        series["crop_share_improved_seed"] = improved.groupby(by_household).mean()

    if "s4q02" in planting.columns:
        series["crop_share_pure_stand"] = (
            code_of(planting["s4q02"]).eq(1).astype("Float64")
            .groupby(by_household).mean()
        )

    frame = frame_from(series)

    harvest = _harvest_features()
    if harvest is not None:
        frame = frame.merge(harvest, on="household_id", how="left")

    return frame


def _harvest_features() -> pd.DataFrame | None:
    try:
        ph = read_module(4, cols.W4["ph_crops"])
    except FileNotFoundError:
        return None

    by_household = ph["household_id"]
    series: dict[str, pd.Series] = {}

    if "s9q06" in ph.columns:
        kg = pd.to_numeric(ph["s9q06"], errors="coerce")
        series["harvest_total_kg"] = kg.groupby(by_household).sum(min_count=1)
        series["harvest_mean_kg"] = kg.groupby(by_household).mean()

    if "s9q10" in ph.columns:
        shortfall = yes_no(ph["s9q10"])
        series["harvest_any_shortfall"] = shortfall.groupby(by_household).max()
        series["harvest_shortfall_rate"] = shortfall.groupby(by_household).mean()

    if "s9q11" in ph.columns:
        series["harvest_pct_area_harvested"] = (
            pd.to_numeric(ph["s9q11"], errors="coerce").groupby(by_household).mean()
        )

    for column, name in SHORTFALL_REASONS.items():
        if column in ph.columns:
            series[f"harvest_loss_{name}"] = (
                yes_no(ph[column]).groupby(by_household).max()
            )

    return frame_from(series) if series else None


def add_yield(frame: pd.DataFrame) -> pd.DataFrame:
    """Yield needs land area, so it is derived after the blocks are joined."""
    if {"harvest_total_kg", "land_total_area"} <= set(frame.columns):
        frame = frame.copy()
        frame["yield_kg_per_area"] = safe_ratio(
            frame["harvest_total_kg"], frame["land_total_area"]
        )
    return frame

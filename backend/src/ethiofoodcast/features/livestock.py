"""Livestock holdings, converted to Tropical Livestock Units.

Source: ``sect8_2_ls_w4`` (42,784 holder-species rows). ``ls_s8_2q01`` is the
number owned 12 months ago, ``ls_code`` the species.

Raw head counts are not comparable across species -- 10 chickens and 10 cattle
are very different assets -- so counts are converted to **TLU**, the standard
FAO cattle-equivalent weighting, giving one interpretable wealth measure.

The species codes below were read off the Wave 4 labels directly, not assumed:
Wave 4 orders them Bulls, Oxen, Cows, Steers, Heifers, Calves, Goats, Sheep,
**Camels**, then three poultry categories, then Horses, Mules, Donkeys, Bees.
Guessing a conventional ordering here puts camel weight on chickens.
"""

from __future__ import annotations

import pandas as pd

from ..config import columns as cols
from ..data.loaders import read_module
from .base import code_of, frame_from, yes_no

SPECIES_LABELS = {
    1: "bulls", 2: "oxen", 3: "cows", 4: "steers", 5: "heifers", 6: "calves",
    7: "goats", 8: "sheep", 9: "camels",
    10: "chicken_cocks", 11: "chicken_hens", 12: "chicks",
    13: "horses", 14: "mules", 15: "donkeys", 16: "bee_colony",
}

# FAO tropical livestock unit coefficients. Bee colonies are an asset but carry
# no TLU weight, so they are counted separately rather than forced onto a
# cattle-equivalent scale.
TLU_BY_SPECIES = {
    1: 0.7, 2: 0.7, 3: 0.7, 4: 0.5, 5: 0.5, 6: 0.2,
    7: 0.1, 8: 0.1, 9: 1.0,
    10: 0.01, 11: 0.01, 12: 0.01,
    13: 0.8, 14: 0.7, 15: 0.7, 16: 0.0,
}

CATTLE_CODES = (1, 2, 3, 4, 5, 6)
SMALL_RUMINANT_CODES = (7, 8)
POULTRY_CODES = (10, 11, 12)
EQUINE_CODES = (13, 14, 15)


def build() -> pd.DataFrame:
    module = read_module(4, cols.W4["livestock_2"])
    by_household = module["household_id"]

    count = pd.to_numeric(module["ls_s8_2q01"], errors="coerce").fillna(0)
    species = code_of(module["ls_code"])

    # An unmapped species must not silently acquire a default weight -- that
    # was how chickens briefly weighed as much as goats.
    unmapped = set(species.dropna().astype(int).unique()) - set(TLU_BY_SPECIES)
    if unmapped:
        raise ValueError(
            f"unmapped livestock species codes {sorted(unmapped)}; "
            "add them to TLU_BY_SPECIES rather than defaulting"
        )

    weights = species.map(TLU_BY_SPECIES).astype("Float64")
    tlu = count * weights

    def head_of(codes) -> pd.Series:
        return count.where(species.isin(codes), 0).groupby(by_household).sum()

    series = {
        "livestock_tlu": tlu.groupby(by_household).sum(),
        "livestock_total_head": count.groupby(by_household).sum(),
        "livestock_n_species": species.where(count > 0).groupby(by_household).nunique(),
        "livestock_cattle": head_of(CATTLE_CODES),
        "livestock_small_ruminants": head_of(SMALL_RUMINANT_CODES),
        "livestock_poultry": head_of(POULTRY_CODES),
        "livestock_equines": head_of(EQUINE_CODES),
        "livestock_camels": head_of((9,)),
        "livestock_bee_colonies": head_of((16,)),
    }

    if "ls_s8_2q02" in module.columns:
        series["livestock_births"] = (
            pd.to_numeric(module["ls_s8_2q02"], errors="coerce")
            .groupby(by_household)
            .sum(min_count=1)
        )
    if "ls_s8_2q03" in module.columns:
        series["livestock_purchased"] = (
            yes_no(module["ls_s8_2q03"]).groupby(by_household).max()
        )

    frame = frame_from(series)
    frame["livestock_any"] = (frame["livestock_total_head"] > 0).astype("Float64")
    return frame

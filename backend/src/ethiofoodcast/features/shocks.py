"""Self-reported shocks in the 12 months before Wave 4.

Source: ``sect9_hh_w4`` -- 20 shock types x 6,770 households = 135,400 rows,
with ``s9q01`` recording whether each was experienced.

Shocks are grouped into domains rather than carried as 20 separate flags: at
this sample size, individually rare shocks (fire, landslide) have too few
positive cases to support a split, but "any climate shock" is well populated
and interpretable.
"""

from __future__ import annotations

from ..config import columns as cols
from ..data.loaders import read_module
from .base import code_of, frame_from, yes_no

SHOCK_CODES = {
    1: "death_breadwinner", 2: "death_child", 3: "death_other",
    4: "illness", 5: "job_loss", 6: "drought", 7: "flood",
    8: "landslide", 9: "heavy_rains", 10: "crop_damage",
    11: "price_fall_output", 12: "price_rise_food", 13: "price_rise_inputs",
    14: "livestock_loss", 15: "fire", 16: "theft", 17: "loss_of_land",
    18: "displacement", 19: "unrest", 20: "other",
}

DOMAINS = {
    "climate": (6, 7, 8, 9),
    "agricultural": (6, 7, 9, 10, 14),
    "economic": (5, 11, 12, 13),
    "health": (1, 2, 3, 4),
    "conflict": (16, 17, 18, 19),
}

# Kept as individual flags because each is common enough to model and directly
# actionable in the recommendation layer.
KEEP_INDIVIDUAL = (6, 7, 10, 14, 12, 4)


def build():
    module = read_module(4, cols.W4["shocks"])
    by_household = module["household_id"]

    experienced = yes_no(module["s9q01"]).fillna(0)
    shock = code_of(module["shock_type"])

    series = {"shock_count": experienced.groupby(by_household).sum()}

    for code in KEEP_INDIVIDUAL:
        series[f"shock_{SHOCK_CODES[code]}"] = (
            experienced.where(shock == code, 0).groupby(by_household).max()
        )

    for domain, codes in DOMAINS.items():
        hit = experienced.where(shock.isin(codes), 0)
        series[f"shock_any_{domain}"] = hit.groupby(by_household).max()
        series[f"shock_n_{domain}"] = hit.groupby(by_household).sum()

    return frame_from(series)

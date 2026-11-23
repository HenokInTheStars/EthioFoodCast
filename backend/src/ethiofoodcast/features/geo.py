"""Market access and environmental conditions.

Source: ``ETH_HouseholdGeovariables_Y4``, one row per household (6,804 rows,
34 more than the survey itself -- a left join drops the extras harmlessly).

``lat_mod`` and ``lon_mod`` are deliberately excluded: they are
displacement-modified coordinates, and including them would let a model
memorise geography instead of learning about household conditions.
"""

from __future__ import annotations

import pandas as pd

from ..config import columns as cols
from ..data.loaders import read_module
from .base import safe_ratio

DIRECT = {
    "dist_road": "geo_dist_road",
    "dist_market": "geo_dist_market",
    "dist_popcenter": "geo_dist_popcenter",
    "dist_admhq": "geo_dist_admhq",
    "srtm1k": "geo_elevation",
    "slopepct": "geo_slope_pct",
    "popdensity": "geo_pop_density",
    "cropshare": "geo_cropshare",
    "h2018_tot": "geo_rain_2018",
    "h2019_tot": "geo_rain_2019",
    "anntot_avg": "geo_rain_long_term_avg",
    "ndvi_avg": "geo_ndvi_avg",
    "ndvi_max": "geo_ndvi_max",
    "h2018_ndvi_avg": "geo_ndvi_2018",
    "h2019_ndvi_avg": "geo_ndvi_2019",
    "twi": "geo_wetness_index",
}

EXCLUDED = ("lat_mod", "lon_mod")


def build():
    module = read_module(4, cols.W4["geovars"])
    frame = module[["household_id"]].copy()

    for source, name in DIRECT.items():
        if source in module.columns:
            frame[name] = pd.to_numeric(module[source], errors="coerce")

    # Anomalies matter more than levels: 600mm is plentiful in one zone and a
    # drought in another. Dividing by the local long-run average makes the
    # figure comparable across the country.
    for year in ("2018", "2019"):
        level = f"geo_rain_{year}"
        if {level, "geo_rain_long_term_avg"} <= set(frame.columns):
            frame[f"geo_rain_anomaly_{year}"] = safe_ratio(
                frame[level], frame["geo_rain_long_term_avg"]
            )

    if {"geo_ndvi_2019", "geo_ndvi_avg"} <= set(frame.columns):
        frame["geo_ndvi_anomaly"] = safe_ratio(
            frame["geo_ndvi_2019"], frame["geo_ndvi_avg"]
        )

    assert not any(c in frame.columns for c in EXCLUDED), "coordinates must not leak"
    return frame

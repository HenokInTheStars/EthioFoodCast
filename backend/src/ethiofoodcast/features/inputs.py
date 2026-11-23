"""Agricultural inputs, extension and productive equipment.

Source: ``sect7_pp_w4`` (2,939 holder rows). Confirmed from the Wave 5
codebook:

    s7q01  crop rotation practised
    s7q02  chemical fertiliser used on any field
    s7q04  participates in the extension programme
    s7q06  receives credit services
    s7q09  does NOT get advisory services   <- negated, see below
    s7q12  own oxen used this Meher season
    s7q14  oxen owned
"""

from __future__ import annotations

import pandas as pd

from ..config import columns as cols
from ..data.loaders import read_module
from .base import frame_from, yes_no

BINARY_INPUTS = {
    "s7q01": "crop_rotation",
    "s7q02": "fertiliser",
    "s7q04": "extension",
    "s7q06": "credit_services",
}

COUNT_INPUTS = {"s7q12": "oxen_used", "s7q14": "oxen_owned"}


def build() -> pd.DataFrame:
    module = read_module(4, cols.W4["pp_extension"])
    by_household = module["household_id"]

    series: dict[str, pd.Series] = {}

    for column, name in BINARY_INPUTS.items():
        if column in module.columns:
            series[f"input_{name}"] = yes_no(module[column]).groupby(by_household).max()

    # s7q09 asks whether the household does NOT get advisory services, so it is
    # inverted to keep every feature pointing the same way: 1 = has the service.
    if "s7q09" in module.columns:
        lacks_advisory = yes_no(module["s7q09"])
        series["input_advisory"] = (
            (1 - lacks_advisory).groupby(by_household).max()
        )

    for column, name in COUNT_INPUTS.items():
        if column in module.columns:
            series[f"input_{name}"] = (
                pd.to_numeric(module[column], errors="coerce")
                .groupby(by_household)
                .sum(min_count=1)
            )

    frame = frame_from(series)

    if "input_oxen_owned" in frame.columns:
        frame["input_has_oxen"] = (frame["input_oxen_owned"] > 0).astype("Float64")

    return frame

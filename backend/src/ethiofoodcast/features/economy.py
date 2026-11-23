"""Consumption, assets, credit, safety-net participation and non-farm income.

Sources: ``cons_agg_w4`` (ready-made consumption aggregates), ``sect12a_hh_w4``
(credit), ``sect14_hh_w4`` (assistance -- code 1 is Direct support through
PSNP), ``sect15a_hh_w4`` (non-farm enterprise), ``sect11_hh_w4`` (durables).
"""

from __future__ import annotations

import pandas as pd

from ..config import columns as cols
from ..data.loaders import read_module
from .base import code_of, frame_from, safe_ratio, yes_no

PSNP_CODE = 1
FREE_FOOD_CODE = 2


def build():
    consumption = read_module(4, cols.W4["consumption"])
    frame = consumption[["household_id"]].copy()

    for source, name in (
        ("total_cons_ann", "cons_total_annual"),
        ("nom_totcons_aeq", "cons_per_adult_eq"),
        ("food_cons_ann", "cons_food_annual"),
        ("adulteq", "adult_equivalents"),
    ):
        if source in consumption.columns:
            # Raw values kept; clipping is fitted per fold at model time.
            frame[name] = pd.to_numeric(consumption[source], errors="coerce")

    if "cons_quint" in consumption.columns:
        frame["cons_quintile"] = pd.to_numeric(consumption["cons_quint"], errors="coerce")

    if {"cons_food_annual", "cons_total_annual"} <= set(frame.columns):
        # Engel's law: the share of spending going to food rises as a household
        # gets poorer, so the share is a poverty signal in its own right.
        frame["cons_food_share"] = safe_ratio(
            frame["cons_food_annual"], frame["cons_total_annual"]
        )

    frame = frame.merge(_assistance(), on="household_id", how="left")
    frame = frame.merge(_assets(), on="household_id", how="left")

    credit = _credit()
    if credit is not None:
        frame = frame.merge(credit, on="household_id", how="left")

    nonfarm = _nonfarm()
    if nonfarm is not None:
        frame = frame.merge(nonfarm, on="household_id", how="left")

    return frame


def _assistance():
    module = read_module(4, cols.W4["assistance"])
    by_household = module["household_id"]
    received = yes_no(module["s14q01"]).fillna(0)
    kind = code_of(module["assistance_cd"])

    return frame_from(
        {
            "econ_any_assistance": received.groupby(by_household).max(),
            "econ_psnp": received.where(kind == PSNP_CODE, 0).groupby(by_household).max(),
            "econ_free_food": received.where(kind == FREE_FOOD_CODE, 0)
            .groupby(by_household)
            .max(),
        }
    )


def _assets():
    module = read_module(4, cols.W4["assets"])
    by_household = module["household_id"]
    owned = pd.to_numeric(module.get("s11q01"), errors="coerce").fillna(0)

    return frame_from(
        {
            "econ_n_asset_types": (owned > 0).groupby(by_household).sum(),
            "econ_total_assets": owned.groupby(by_household).sum(),
        }
    )


def _credit():
    """Borrowing and, more importantly, being refused credit.

    s15q01 = borrowed at least 150 Birr in the last 12 months.
    s15q11 = tried to borrow and was TURNED DOWN -- a direct measure of credit
    constraint, and one of the vulnerabilities the recommendation layer acts on.
    """
    module = read_module(4, cols.W4["credit"])
    by_household = module["household_id"]
    series = {}

    if "s15q01" in module.columns:
        series["econ_borrowed"] = yes_no(module["s15q01"]).groupby(by_household).max()
    if "s15q11" in module.columns:
        series["econ_credit_refused"] = (
            yes_no(module["s15q11"]).groupby(by_household).max()
        )

    return frame_from(series) if series else None


def _nonfarm():
    """Non-farm enterprise, a multi-select block of eight business types.

    The cells hold label strings ('1. YES'), so they must be decoded rather
    than coerced with to_numeric -- which silently produced an all-null column.
    """
    module = read_module(4, cols.W4["nonfarm"])
    flags = [c for c in module.columns if c.startswith("s12aq01__")]
    if not flags:
        return None

    decoded = pd.DataFrame({c: yes_no(module[c]) for c in flags})
    by_household = module["household_id"]

    return frame_from(
        {
            "econ_has_nonfarm_business": decoded.max(axis=1).groupby(by_household).max(),
            "econ_n_nonfarm_types": decoded.sum(axis=1).groupby(by_household).max(),
        }
    )

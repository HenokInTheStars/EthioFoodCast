"""Zone-level shocks between the two waves, from the Joint Food Security Monitor.

The model's blind spot is the gap: predictors stop in 2019, the outcome is
measured in 2021/22, and in between came COVID-19, the northern conflict,
drought and an inflation crisis. The JMR (World Bank catalogue 8284) measures
exactly those, monthly, per admin-2 zone.

This module builds experimental update-model features, not W4-only forecasts.
A performance gain would establish predictive utility, not a causal effect.
The fixed observation window ends in August 2021. Publication/revision dates
must also be audited before claiming historical real-time availability.
A verified household-to-zone crosswalk and held-out-zone evaluation are
required before promoting these features to production.
"""

from __future__ import annotations

import pandas as pd

# Fieldwork for Wave 5 began 2021-09-30 at the earliest date that could be
# verified. The window stops before that for every household.
WINDOW_START = "2019-01-01"
WINDOW_END = "2021-08-31"

# Measured conditions only. GLM is a model prediction; Target is the outcome.
SHOCK_INDICATORS = (
    "Conflict",
    "Drought - NDVI",
    "Drought - rainfall",
    "Food prices",
    "Volatility - Food prices",
    "Exchange rates",
    "Volatility - Exchange rate",
)

EXCLUDED_INDICATORS = ("GLM", "Target")

PREFIX = "jmr"

_SHORT = {
    "Conflict": "conflict",
    "Drought - NDVI": "ndvi",
    "Drought - rainfall": "rain",
    "Food prices": "price",
    "Volatility - Food prices": "price_vol",
    "Exchange rates": "fx",
    "Volatility - Exchange rate": "fx_vol",
}


def prepare(frame: pd.DataFrame, *, ipc_cutoff: int) -> pd.DataFrame:
    """Validate and select one IPC variant before monthly aggregation."""
    required = {"date", "indicator", "grouping", "adm2_pcode", "value", "ipc phase cutoff"}
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"Missing JMR columns: {sorted(missing)}")
    frame = frame.copy()
    frame["date"] = pd.to_datetime(frame["date"], errors="raise")
    if frame["date"].isna().any():
        raise ValueError("Missing JMR dates")
    cutoff = pd.to_numeric(frame["ipc phase cutoff"], errors="raise")
    if ipc_cutoff not in set(cutoff.dropna()):
        raise ValueError(f"IPC cutoff {ipc_cutoff} is absent")
    frame = frame.loc[
        cutoff.eq(ipc_cutoff)
        & frame.date.between(WINDOW_START, WINDOW_END)
        & frame.indicator.isin(SHOCK_INDICATORS)
        & frame.grouping.isin(["Indicator value", "Alert level"])
    ].copy()
    if frame.adm2_pcode.isna().any():
        raise ValueError("Missing JMR zone codes")
    frame["value"] = pd.to_numeric(frame["value"], errors="raise")
    frame["date"] = frame.date.dt.to_period("M").dt.to_timestamp()
    keys = ["adm2_pcode", "date", "indicator", "grouping"]
    if (frame.groupby(keys).value.nunique(dropna=False) > 1).any():
        raise ValueError("Conflicting JMR values within a zone/month/indicator/group")
    return frame.drop_duplicates(keys)


def load(path, *, ipc_cutoff: int) -> pd.DataFrame:
    return prepare(pd.read_csv(path), ipc_cutoff=ipc_cutoff)


def build(jmr: pd.DataFrame, zone_by_household: pd.Series, *, ipc_cutoff: int) -> pd.DataFrame:
    """Return household_id plus features; enforce constraints on every call.

    Missing mapped zones remain missing features, never assumed safe.
    """
    if zone_by_household.index.has_duplicates or zone_by_household.index.isna().any():
        raise ValueError("Household mapping must have unique, nonmissing IDs")
    jmr = prepare(jmr, ipc_cutoff=ipc_cutoff)
    values = jmr[jmr["grouping"] == "Indicator value"]
    alerts = jmr[jmr["grouping"] == "Alert level"]

    per_zone = {}

    for indicator in SHOCK_INDICATORS:
        short = _SHORT[indicator]
        block = values[values["indicator"] == indicator]
        if block.empty:
            continue
        grouped = block.sort_values("date").groupby("adm2_pcode")["value"]
        per_zone[f"{PREFIX}_{short}_mean"] = grouped.mean()
        per_zone[f"{PREFIX}_{short}_max"] = grouped.max()
        # The state the household was left in going into Wave 5, as distinct
        # from the average over two and a half years.
        per_zone[f"{PREFIX}_{short}_last"] = grouped.last()

        alert = alerts[alerts["indicator"] == indicator]
        if not alert.empty:
            a = alert.groupby("adm2_pcode")["value"]
            per_zone[f"{PREFIX}_{short}_alert_max"] = a.max()
            per_zone[f"{PREFIX}_{short}_alert_months"] = (
                alert.assign(hi=(alert["value"] >= 2).astype(float).where(alert["value"].notna()))
                .groupby("adm2_pcode")["hi"].sum(min_count=1)
            )

    zone_frame = pd.DataFrame(per_zone)
    zone_frame.index.name = "adm2_pcode"

    mapped = zone_by_household.rename("adm2_pcode").to_frame()
    joined = mapped.join(zone_frame, on="adm2_pcode")

    # Whether the zone was matched at all is itself informative to the reader,
    # though it must not be read as a condition of the household.
    joined[f"{PREFIX}_has_zone_data"] = (
        joined.drop(columns="adm2_pcode").notna().any(axis=1).astype(float)
    )
    return joined.drop(columns="adm2_pcode").rename_axis("household_id").reset_index()


def feature_columns(frame: pd.DataFrame) -> list[str]:
    return [c for c in frame.columns if c.startswith(PREFIX)]


def assemble_update(base: pd.DataFrame, jmr: pd.DataFrame,
                    zone_by_household: pd.Series, *, ipc_cutoff: int) -> pd.DataFrame:
    """Explicit update dataset; never called by the W4-only assembler."""
    if feature_columns(base):
        raise ValueError("Base already contains JMR features")
    if not zone_by_household.index.isin(base.household_id).all():
        raise ValueError("Crosswalk contains households outside the base table")
    block = build(jmr, zone_by_household, ipc_cutoff=ipc_cutoff)
    result = base.merge(block, on="household_id", how="left", validate="one_to_one")
    result["jmr_has_zone_data"] = result.jmr_has_zone_data.fillna(0.)
    if not result.jmr_has_zone_data.any():
        raise ValueError("No household has matched JMR observations")
    return result

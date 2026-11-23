"""Chronic vs transitory food insecurity, from the HFPS round series.

**The design decision that makes this sound: one row per household.**

Eight rounds of the same ~600 households is not ~4,800 independent
observations. Stacking household-round rows would be pseudo-replication --
it inflates every metric, shrinks confidence intervals to nonsense, and lets
a model memorise households rather than learn conditions. So the rounds are
collapsed into a household-level outcome panel before any model sees them.

The distinction this buys is the point. A household insecure in 1 of 8 rounds
and one insecure in 7 of 8 receive the same label under the Wave 5 snapshot
target. A safety-net targeting tool needs to tell them apart: persistent
vulnerability calls for a different response than a single bad season.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from ..data.hfps import load_round

# Wave 4 household interviews ran to September 2019; this is the median, used
# as the anchor for every horizon measurement.
W4_REFERENCE_DATE = pd.Timestamp("2019-06-20")

# Fieldwork midpoints, read from each round's cs_startdate.
ROUND_DATES = {
    1: "2020-05-01", 2: "2020-05-20", 3: "2020-06-17", 4: "2020-08-08",
    5: "2020-09-05", 6: "2020-10-02", 11: "2021-04-25",
    15: "2023-03-09", 17: "2023-07-22", 18: "2023-10-16",
}

# A household insecure in at least half the rounds it was observed in.
# Deliberately a round *share*, not a count: a household seen 3 times and
# insecure twice is more persistently affected than one seen 8 times and
# insecure three times.
CHRONIC_THRESHOLD = 0.5


def months_since_wave4(round_number: int) -> float | None:
    """Horizon in months between the Wave 4 interview and a round."""
    date = ROUND_DATES.get(round_number)
    if date is None:
        return None
    return round((pd.Timestamp(date) - W4_REFERENCE_DATE).days / 30.44, 1)


def build_round_panel(
    zip_path: Path, coverage: pd.DataFrame, household_ids: set[str]
) -> pd.DataFrame:
    """Long panel of (household, round) outcomes over the comparable rounds."""
    usable = coverage[coverage["comparable"]]
    frames = []

    for _, entry in usable.iterrows():
        round_number = int(entry["round"])
        outcomes = load_round(zip_path, entry["file"])
        outcomes = outcomes[
            outcomes["household_id"].isin(household_ids)
            & outcomes["food_insecure"].notna()
        ]
        if outcomes.empty:
            continue

        frames.append(
            outcomes.assign(
                round=round_number,
                months_since_w4=months_since_wave4(round_number),
            )[["household_id", "round", "months_since_w4", "food_insecure"]]
        )

    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def build_chronic_targets(round_panel: pd.DataFrame) -> pd.DataFrame:
    """Collapse the round panel to one row per household."""
    grouped = round_panel.groupby("household_id")["food_insecure"]

    out = pd.DataFrame(
        {
            "fi_rounds_insecure": grouped.sum().astype(int),
            # Exposure control, not bookkeeping. Coverage falls from 593 to 344
            # across the series, so a household seen in 3 rounds has fewer
            # chances to be RECORDED insecure than one seen in 8. Without this
            # as a covariate, differential attrition is confounded with the
            # outcome.
            "n_rounds_observed": grouped.size().astype(int),
        }
    )
    out["fi_share"] = (out["fi_rounds_insecure"] / out["n_rounds_observed"]).round(4)

    out["fi_ever"] = (out["fi_rounds_insecure"] > 0).astype(int)
    out["fi_chronic"] = (out["fi_share"] >= CHRONIC_THRESHOLD).astype(int)
    out["fi_never"] = (out["fi_rounds_insecure"] == 0).astype(int)
    out["fi_transitory"] = (
        (out["fi_ever"] == 1) & (out["fi_chronic"] == 0)
    ).astype(int)

    out["fi_status"] = "never"
    out.loc[out["fi_transitory"] == 1, "fi_status"] = "transitory"
    out.loc[out["fi_chronic"] == 1, "fi_status"] = "chronic"

    return out.reset_index()


def status_summary(targets: pd.DataFrame) -> pd.DataFrame:
    """Distribution of the three statuses, with mean exposure per group."""
    summary = (
        targets.groupby("fi_status")
        .agg(
            n=("household_id", "size"),
            mean_rounds_observed=("n_rounds_observed", "mean"),
            mean_fi_share=("fi_share", "mean"),
        )
        .reset_index()
    )
    summary["pct"] = (100 * summary["n"] / len(targets)).round(1)
    summary["mean_rounds_observed"] = summary["mean_rounds_observed"].round(1)
    summary["mean_fi_share"] = summary["mean_fi_share"].round(3)
    return summary.sort_values("n", ascending=False)

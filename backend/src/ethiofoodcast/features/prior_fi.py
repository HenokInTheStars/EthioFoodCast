"""Prior food-insecurity history, from Wave 4.

Source: ``sect8_hh_w4``. This is **not** the Wave 5 FIES block -- Wave 4 asks a
differently structured coping/food-security module -- so the items are treated
as a related-but-distinct history signal rather than a comparable score.

These features exist to be *removed*: Feature Set B drops this whole block, so
the project can answer whether agricultural and household conditions predict
risk independently of a household's food-insecurity history.

**The module used three of roughly thirty available variables.** ``s8q02a-h``
are the eight Coping Strategy Index items -- "number of days in the last seven
the household had to ..." -- answered on a 0-7 scale by all 6,770 households
with no missingness. Only ``s8q02a`` was read, and it was labelled
"days without enough food"; its actual question is "number of days the
household had to rely on less preferred foods", which is the mildest item in
the set. Labels were taken from the official DDI codebook (catalogue 3823),
not inferred.

A graded severity scale over a full week is a different and better signal than
three yes/no flags, and it costs nothing to build.
"""

from __future__ import annotations

import pandas as pd

from ..config import columns as cols
from ..data.loaders import read_module
from .base import frame_from, yes_no

# Confirmed Wave 4 yes/no food-security items.
W4_ITEMS = ("s8q01", "s8q04", "s8q06")

PREFIX = "prior_fi"


def build() -> pd.DataFrame:
    module = read_module(4, cols.W4["food_security"])
    by_household = module["household_id"]

    items = {c: yes_no(module[c]) for c in W4_ITEMS if c in module.columns}
    flags = pd.DataFrame(items)

    # `sum` and `max` treat missing as zero, so a household that answered
    # nothing scored 0 (looking food secure) and a mix of "No" plus missing
    # produced a confident negative. Both are unknown, not negative.
    #
    # The same resolution rule as the Wave 5 target: a "Yes" is definitive
    # whatever else is missing; "all No" is definitive only if everything was
    # answered; anything else stays unknown.
    observed_yes = (flags == 1).any(axis=1)
    fully_answered = flags.notna().all(axis=1)

    resolved_any = pd.Series(pd.NA, index=flags.index, dtype="Float64")
    resolved_any[observed_yes] = 1.0
    resolved_any[~observed_yes & fully_answered] = 0.0

    # The score is a count, so it is only meaningful over a complete response.
    resolved_score = flags.sum(axis=1).where(fully_answered).astype("Float64")

    series = {
        f"{PREFIX}_any": resolved_any.groupby(by_household).first(),
        f"{PREFIX}_score": resolved_score.groupby(by_household).first(),
    }
    for name, values in items.items():
        series[f"{PREFIX}_{name}"] = values.groupby(by_household).first()

    series.update(_coping(module, by_household))
    series.update(_meals(module, by_household))

    return frame_from(series)


def _coping(module: pd.DataFrame, by_household: pd.Series) -> dict:
    """Coping Strategy Index features from the eight ``s8q02`` day-counts.

    Each item is days in the last seven, 0-7. Three summaries are built
    because they answer different questions: how severely the household
    coped (weighted), how broadly (how many strategies at all), and whether
    it reached the two strategies that indicate outright destitution.
    """
    available = {
        key: pd.to_numeric(module[column], errors="coerce")
        for key, column in cols.W4_COPING_ITEMS.items()
        if column in module.columns
    }
    if not available:
        return {}

    frame = pd.DataFrame(available)

    # Days are bounded at a week. Anything outside that is a coding error, not
    # a household that coped for nine days out of seven.
    frame = frame.where((frame >= 0) & (frame <= 7))

    out: dict[str, pd.Series] = {}

    # The reduced CSI: the standard five items with their published weights,
    # so the number is comparable with the wider food-security literature
    # rather than being a bespoke index.
    weighted = [
        (key, weight)
        for key, weight in cols.RCSI_WEIGHTS.items()
        if key in frame.columns
    ]
    if len(weighted) == len(cols.RCSI_WEIGHTS):
        rcsi = sum(frame[key] * weight for key, weight in weighted)
        # A partial response cannot be summed into a severity score.
        out[f"{PREFIX}_rcsi"] = rcsi.where(
            frame[[k for k, _ in weighted]].notna().all(axis=1)
        )

    complete = frame.notna().all(axis=1)
    out[f"{PREFIX}_coping_days"] = frame.sum(axis=1).where(complete)
    out[f"{PREFIX}_coping_breadth"] = (frame > 0).sum(axis=1).where(complete)
    out[f"{PREFIX}_coping_max"] = frame.max(axis=1).where(complete)

    # The destitution end of the scale: no food in the house at all, or a
    # whole day and night without eating. Rare (5% and 2% of households) and
    # categorically different from limiting portion sizes.
    severe = [k for k in ("no_food", "whole_day") if k in frame.columns]
    if severe:
        out[f"{PREFIX}_coping_severe_days"] = frame[severe].sum(axis=1).where(
            frame[severe].notna().all(axis=1)
        )
        out[f"{PREFIX}_coping_severe_any"] = (
            (frame[severe] > 0).any(axis=1).astype("Float64")
            .where(frame[severe].notna().all(axis=1))
        )

    for key in frame.columns:
        out[f"{PREFIX}_cope_{key}"] = frame[key]

    return {name: s.groupby(by_household).first() for name, s in out.items()}


def _meals(module: pd.DataFrame, by_household: pd.Series) -> dict:
    """Meals per day, for over-fives and for children.

    The children's question is only asked of households that have children,
    so its absence is structural, not non-response -- it gets an explicit
    flag rather than being imputed alongside genuine refusals. Code 99 means
    "no people in the age group" and must not be read as 99 meals.
    """
    out: dict[str, pd.Series] = {}

    if cols.W4_MEALS["adult"] in module.columns:
        adult = pd.to_numeric(module[cols.W4_MEALS["adult"]], errors="coerce")
        out[f"{PREFIX}_meals_adult"] = adult.where((adult >= 0) & (adult <= 10))

    if cols.W4_MEALS["child"] in module.columns:
        child = pd.to_numeric(module[cols.W4_MEALS["child"]], errors="coerce")
        child = child.where((child >= 0) & (child <= 10))
        out[f"{PREFIX}_meals_child"] = child
        out[f"{PREFIX}_has_child_meals"] = child.notna().astype("Float64")

    return {name: s.groupby(by_household).first() for name, s in out.items()}


def feature_columns(frame: pd.DataFrame) -> list[str]:
    """Columns Feature Set B must exclude."""
    return [c for c in frame.columns if c.startswith(PREFIX)]

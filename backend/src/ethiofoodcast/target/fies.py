"""Wave 5 food-insecurity target construction.

Source: ``sect8_hh_w5``, 4,959 households, eight experience items coded
1=YES / 2=NO with 2-10 missing each.

Two properties of the real data shape the code:

1. **The recall periods are not uniform.** Seven items ask about the last 12
   months; ``s8q06`` (went a whole day without eating) asks about the last
   **30 days**. The project brief assumed 12 months throughout. This is not
   corrected -- the answer cannot be rebased -- but it is recorded, because it
   makes the raw score a sum over mixed windows and biases ``s8q06`` downward
   relative to its siblings.

2. **Missingness is resolved logically, never imputed.** The target is the
   thing being predicted; filling it in would manufacture the outcome.
"""

from __future__ import annotations

import pandas as pd

from ..cleaning.codebook import yes_no_to_binary
from ..config.columns import FIES_ITEMS, FIES_SEVERE_ITEMS

# s8q06 asks about the last 30 days; every other item asks about 12 months.
DIFFERENT_RECALL = {"s8q06": "last 30 days"}

# FIES raw-score bands. Documented as a survey-derived severity grouping, NOT
# an FAO-calibrated FIES prevalence classification -- that requires a Rasch
# calibration step this project does not perform.
RISK_BANDS = ((0, 3, "Low"), (4, 6, "Moderate"), (7, 8, "High"))


class MissingFiesColumns(ValueError):
    """Raised when the source frame lacks FIES questions the target needs."""


def to_binary_items(frame: pd.DataFrame, *, require_all: bool = True) -> pd.DataFrame:
    """Return the eight FIES items as 1/0, preserving missing.

    An absent *column* is not the same as an unanswered *question*, and
    conflating them silently mislabels households. Dropping absent columns made
    a household with a single "No" and seven missing questions look fully
    answered and therefore food secure -- the "all observed are No" branch in
    `_resolve_any` cannot tell a complete No from a solitary one.

    So a missing column is an error by default. `require_all=False` exists only
    for diagnostics on deliberately partial frames.
    """
    missing = [c for c in FIES_ITEMS if c not in frame.columns]
    if missing and require_all:
        raise MissingFiesColumns(
            f"FIES items absent from the source frame: {missing}. "
            "The target cannot be built from a partial question set -- an "
            "absent column would be read as an answered 'No'."
        )

    present = [c for c in FIES_ITEMS if c in frame.columns]
    return pd.DataFrame(
        {c: yes_no_to_binary(frame[c]) for c in present}, index=frame.index
    )


def _resolve_any(items: pd.DataFrame) -> pd.Series:
    """'Did the household report ANY of these?', resolved without imputing.

    Three cases, in order:

      * any observed YES        -> 1. Definitive: the missing answers cannot
                                   undo a reported experience.
      * all observed, all NO    -> 0. Definitive.
      * otherwise               -> missing. Some answers are absent and the
                                   observed ones are all NO, so a YES among
                                   the missing would flip the result. That is
                                   genuinely unresolvable, and the household is
                                   excluded and counted rather than guessed at.
    """
    any_yes = (items == 1).any(axis=1)
    all_answered = items.notna().all(axis=1)

    resolved = pd.Series(pd.NA, index=items.index, dtype="Int64")
    resolved[any_yes] = 1
    resolved[~any_yes & all_answered] = 0
    return resolved


def build_targets(frame: pd.DataFrame) -> pd.DataFrame:
    """Build every target variant, keyed by household_id."""
    items = to_binary_items(frame)

    severe = [c for c in FIES_SEVERE_ITEMS if c in items.columns]
    if len(severe) != len(FIES_SEVERE_ITEMS):
        raise MissingFiesColumns(
            "the primary target needs every severe item; missing "
            f"{sorted(set(FIES_SEVERE_ITEMS) - set(severe))}"
        )

    out = pd.DataFrame(index=frame.index)
    if "household_id" in frame.columns:
        out["household_id"] = frame["household_id"]

    # Primary target: material restriction on food actually eaten. Excludes
    # s8q01 (worry) and s8q02 (diet quality), which register concern rather
    # than a restriction.
    out["food_insecure"] = _resolve_any(items[severe])

    # Permissive comparator: any of the eight.
    out["fies_any"] = _resolve_any(items)

    # Severity score. Only defined where every item was answered -- summing
    # over partial responses would score an incomplete household lower than a
    # complete one purely for having skipped questions.
    complete = items.notna().all(axis=1)
    out["fies_raw_score"] = items.sum(axis=1).where(complete).astype("Int64")

    out["risk_band"] = pd.Series(pd.NA, index=frame.index, dtype="object")
    for low, high, label in RISK_BANDS:
        in_band = out["fies_raw_score"].between(low, high)
        out.loc[in_band.fillna(False), "risk_band"] = label

    out["n_items_answered"] = items.notna().sum(axis=1).astype(int)
    out["target_resolved"] = out["food_insecure"].notna().astype(int)

    for column in items.columns:
        out[f"item_{column}"] = items[column].astype("Int64")

    return out


def target_summary(targets: pd.DataFrame) -> pd.DataFrame:
    """Class balance and resolution rates for every target variant."""
    n = len(targets)
    rows = []

    for name in ("food_insecure", "fies_any"):
        series = targets[name]
        resolved = series.notna().sum()
        positive = int((series == 1).sum())
        rows.append(
            {
                "target": name,
                "n_total": n,
                "n_resolved": int(resolved),
                "n_unresolved": int(n - resolved),
                "n_positive": positive,
                "n_negative": int(resolved - positive),
                "positive_pct": round(100 * positive / resolved, 1) if resolved else None,
            }
        )

    score = targets["fies_raw_score"]
    rows.append(
        {
            "target": "fies_raw_score",
            "n_total": n,
            "n_resolved": int(score.notna().sum()),
            "n_unresolved": int(score.isna().sum()),
            "n_positive": None,
            "n_negative": None,
            "positive_pct": None,
        }
    )
    return pd.DataFrame(rows)


def item_summary(targets: pd.DataFrame) -> pd.DataFrame:
    """Per-item YES rate, with the recall period attached."""
    rows = []
    for code, description in FIES_ITEMS.items():
        column = f"item_{code}"
        if column not in targets.columns:
            continue
        series = targets[column]
        answered = int(series.notna().sum())
        yes = int((series == 1).sum())
        rows.append(
            {
                "item": code,
                "description": description,
                "recall": DIFFERENT_RECALL.get(code, "last 12 months"),
                "in_primary_target": code in FIES_SEVERE_ITEMS,
                "n_answered": answered,
                "n_missing": int(series.isna().sum()),
                "n_yes": yes,
                "yes_pct": round(100 * yes / answered, 1) if answered else None,
            }
        )
    return pd.DataFrame(rows)

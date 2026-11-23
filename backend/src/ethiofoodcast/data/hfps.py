"""Ethiopia High-Frequency Phone Survey (2020-2024) inventory and matching.

HFPS follows a subsample of the same ESS4 households by phone, so it can
supply food-security outcomes at many points between Wave 4 and Wave 5 -- and
beyond. Two facts make it awkward, and both are measured here rather than
assumed:

1. **The FIES module is not in every round.** HFPS is explicitly modular.
   Rounds 2-6 and 11 carry the full eight items under ``fi<N>_<name>`` names;
   rounds 15, 17 and 18 carry them under ``fies_<N>``. Round 1 carries only
   three (items 6, 7, 8). Rounds 7-10, 12-14, 16 and 19 carry none.

2. **A round's row count is not its answered count.** Round 15 has 2,521 rows
   but 1,282 of them are blank across every FIES item, so usable n is roughly
   half what the file size suggests.

**How the items were identified.** An earlier version of this module matched
items to Wave 5 by comparing prevalences. That is not identification -- two
different questions can have similar rates -- so it was redone from the
published questionnaires, recorded in
``reports/data_feasibility/fies_questionnaire_audit.json``:

* Rounds 2, 3 and 11: the questionnaire carries "Section 7. Food Insecurity
  Experience Scale" with all eight items, verbatim Wave 5 wording, in Wave 5
  order, read left-to-right from the header row. Verified on question text,
  not on numbering or prevalence.
* Round 6: the published workbook is **incomplete** -- it has no Section 7
  sheet at all (sheets run 1, 3, 4, 5a, 5b, 6, 8, 9, 10). The microdata
  nevertheless carries all eight items answered by 2,701-2,704 of 2,704
  households, with yes-rates continuing the trend from rounds 4 and 5. The
  module is treated as administered: the document is missing a page, the
  survey is not missing a section.
* Rounds 4, 5, 15, 17 and 18: no questionnaire was retrieved. They are
  accepted on two converging pieces of evidence -- self-documenting column
  names, and a severity profile matching the verified rounds item for item
  (item 1 highest at ~0.33-0.46, item 6 lowest at ~0.05-0.11).

The ``fi<N>_<name>`` and ``fies_<N>`` names agree with each other and with
Wave 5 on all eight positions.
"""

from __future__ import annotations

import re
import zipfile
from pathlib import Path

import pandas as pd

from .ids import normalise_id_column

HFPS_ZIP_NAME = "ETH_2020-2024_HFPS_v15_M_CSV.zip"

# The full eight-item block, in ESS order.
FULL_FIES = tuple(f"fies_{i}" for i in range(1, 9))

# Position -> the names the same question goes by. Position N is Wave 5's
# s8q0N; the module docstring records how this was established.
ITEM_ALIASES = {
    1: ("fies_1", "fi1_enough"),           # worried about not having enough
    2: ("fies_2", "fi2_healthy"),          # unable to eat healthy/preferred
    3: ("fies_3", "fi3_fewkinds"),         # ate only a few kinds
    4: ("fies_4", "fi4_skipmeal"),         # had to skip a meal
    5: ("fies_5", "fi5_ateless"),          # ate less than they should
    6: ("fies_6", "fi6_noteatfullday"),    # whole day without eating
    7: ("fies_7", "fi7_outoffood"),        # ran out of food
    8: ("fies_8", "fi8_hungrynoteat"),     # hungry but did not eat
}

# Retained for callers that referenced these two individually.
LEGACY_SKIP_MEAL = "fi4_skipmeal"
LEGACY_HUNGRY = "fi8_hungrynoteat"

# The outcome definition, matched to Wave 5's: material food-access
# restriction, excluding the two mild items (worried, unable to eat healthy).
# Using the same six items as the Wave 5 target is what makes the HFPS series
# a horizon comparison for the primary model rather than a different question.
OUTCOME_POSITIONS = (3, 4, 5, 6, 7, 8)
N_OUTCOME_ITEMS = len(OUTCOME_POSITIONS)

# A round can only produce a comparable ZERO if it carries every item in the
# definition -- a missing item can only push the rate down. Round 1 has three
# of the six, so its negatives are not comparable with the other rounds'.
CONSISTENT_ITEMS = {
    f"item_{pos}": ITEM_ALIASES[pos] for pos in OUTCOME_POSITIONS
}

YES_TEXT = {"yes", "1. yes"}
NO_TEXT = {"no", "2. no"}
NON_RESPONSE_TEXT = {"refused", "don't know", "dont know", "do not know"}


def round_of(filename: str) -> int | None:
    """Extract the survey round from an HFPS filename."""
    match = re.search(r"round(\d+)", filename) or re.match(r"r(\d+)_", filename)
    return int(match.group(1)) if match else None


def to_binary(series: pd.Series) -> pd.Series:
    """Map a yes/no item to 1/0, detecting which coding scheme the round used.

    HFPS is not internally consistent: most rounds store 'Yes'/'No' text, but
    round 11 stores 0/1 integers. A mapper that assumes one scheme silently
    nulls the other's negatives -- which made round 11 report 100% food
    insecurity, because only the yes-answers survived.

    So the scheme is inferred from the values actually present:
      * text            -> yes/no words, refusals to null
      * numeric {0, 1}  -> 0 = no,  1 = yes
      * numeric {1, 2}  -> 1 = yes, 2 = no   (the ESS convention)
    """
    out = pd.Series(pd.NA, index=series.index, dtype="Float64")
    lowered = series.astype("string").str.strip().str.lower()

    is_text = lowered.isin(YES_TEXT | NO_TEXT | NON_RESPONSE_TEXT)
    if is_text.any():
        out[lowered.isin(YES_TEXT)] = 1.0
        out[lowered.isin(NO_TEXT)] = 0.0
        return out

    numeric = pd.to_numeric(series, errors="coerce")
    present = set(numeric.dropna().unique())

    if present <= {0.0, 1.0}:
        return numeric.astype("Float64")
    if present <= {1.0, 2.0}:
        return numeric.map({1.0: 1.0, 2.0: 0.0}).astype("Float64")

    # Mixed or unexpected codes: keep only the values whose meaning is certain
    # rather than guessing a scheme.
    return numeric.map({1.0: 1.0, 2.0: 0.0, 0.0: 0.0}).astype("Float64")


def inventory(zip_path: Path) -> pd.DataFrame:
    """Which rounds carry which FIES items, and how many households answered."""
    rows = []
    with zipfile.ZipFile(zip_path) as archive:
        for name in sorted(archive.namelist()):
            if not name.endswith(".csv"):
                continue
            try:
                header = pd.read_csv(archive.open(name), nrows=0)
            except Exception:
                continue

            full = [c for c in FULL_FIES if c in header.columns]
            legacy = [
                alias
                for _, (_, alias) in sorted(ITEM_ALIASES.items())
                if alias in header.columns
            ]
            if not full and not legacy:
                continue

            frame = pd.read_csv(
                archive.open(name),
                usecols=["household_id"] + full + legacy,
                dtype={"household_id": "string"},
                low_memory=False,
            )
            items = full or legacy
            answered = frame[items].notna().any(axis=1)

            rows.append(
                {
                    "round": round_of(name),
                    "file": name,
                    "n_rows": len(frame),
                    "n_answered": int(answered.sum()),
                    "n_fies_items": max(len(full), len(legacy)),
                    "n_full_fies_items": len(full),
                    "n_legacy_items": len(legacy),
                    "coverage": "full" if max(len(full), len(legacy)) == 8 else "partial",
                }
            )

    return pd.DataFrame(rows).sort_values("round").reset_index(drop=True)


def load_round(zip_path: Path, filename: str) -> pd.DataFrame:
    """Household-level consistent food-insecurity flag for one round."""
    with zipfile.ZipFile(zip_path) as archive:
        header = pd.read_csv(archive.open(filename), nrows=0)
        wanted = ["household_id"]
        for candidates in CONSISTENT_ITEMS.values():
            wanted += [c for c in candidates if c in header.columns]
        frame = pd.read_csv(
            archive.open(filename), usecols=wanted,
            dtype={"household_id": "string"}, low_memory=False,
        )

    frame["household_id"] = normalise_id_column(frame["household_id"])

    flags = {}
    for label, candidates in CONSISTENT_ITEMS.items():
        column = next((c for c in candidates if c in frame.columns), None)
        if column is not None:
            flags[label] = to_binary(frame[column])

    if not flags:
        return pd.DataFrame(columns=["household_id", "food_insecure", "n_items"])

    items = pd.DataFrame(flags)
    out = pd.DataFrame({"household_id": frame["household_id"]})
    # Any item reported -> insecure. Missing only blocks a 0, never a 1:
    # an unanswered question cannot undo a reported experience.
    any_yes = (items == 1).any(axis=1)
    all_answered = items.notna().all(axis=1)
    out["food_insecure"] = pd.Series(pd.NA, index=items.index, dtype="Int64")
    out.loc[any_yes, "food_insecure"] = 1
    out.loc[~any_yes & all_answered, "food_insecure"] = 0
    out["n_items"] = items.notna().sum(axis=1)

    return out.dropna(subset=["household_id"]).drop_duplicates("household_id")


def coverage_against_panel(
    zip_path: Path, inventory_frame: pd.DataFrame, agricultural_ids: set[str]
) -> pd.DataFrame:
    """How much of the agricultural modelling sample each round actually reaches."""
    rows = []
    for _, entry in inventory_frame.iterrows():
        rounds_data = load_round(zip_path, entry["file"])
        resolved = rounds_data[rounds_data["food_insecure"].notna()]
        matched = resolved[resolved["household_id"].isin(agricultural_ids)]

        # How many of the six outcome items the round actually carries. A round
        # missing any of them is NOT comparable: it can only report a lower
        # rate, because part of the definition is absent.
        items_per_round = int(resolved["n_items"].max()) if len(resolved) else 0

        rows.append(
            {
                "round": entry["round"],
                "coverage": entry["coverage"],
                "n_rows": entry["n_rows"],
                "n_answered": entry["n_answered"],
                "n_resolved": len(resolved),
                "n_consistent_items": items_per_round,
                "n_agricultural_matched": len(matched),
                "pct_of_agricultural_sample": round(
                    100 * len(matched) / max(len(agricultural_ids), 1), 1
                ),
                "insecure_pct": round(100 * matched["food_insecure"].mean(), 1)
                if len(matched)
                else None,
                "comparable": bool(
                    items_per_round == N_OUTCOME_ITEMS
                    and len(matched) >= 300
                    and 0 < matched["food_insecure"].mean() < 1
                ),
            }
        )

    return pd.DataFrame(rows).sort_values("round").reset_index(drop=True)

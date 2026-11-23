"""Household composition and head characteristics, from the Wave 4 roster.

Source: ``sect1_hh_w4`` (29,503 person-rows). Confirmed codings --
``s1q01`` relationship to head (1 = Head), ``s1q02`` sex (1 = Male,
2 = Female), ``s1q03a`` age in completed years.
"""

from __future__ import annotations

import pandas as pd

from ..config import columns as cols
from ..data.loaders import read_module
from .base import code_of, frame_from, safe_ratio

CHILD_MAX_AGE = 14
ELDERLY_MIN_AGE = 65
HEAD_CODE = 1
MALE_CODE = 1


def build() -> pd.DataFrame:
    roster = read_module(4, cols.W4["roster"])

    age = pd.to_numeric(roster["s1q03a"], errors="coerce")
    relationship = code_of(roster["s1q01"])
    sex = code_of(roster["s1q02"])
    by_household = roster["household_id"]

    children = (age <= CHILD_MAX_AGE).groupby(by_household).sum()
    elderly = (age >= ELDERLY_MIN_AGE).groupby(by_household).sum()
    working = (
        ((age > CHILD_MAX_AGE) & (age < ELDERLY_MIN_AGE)).groupby(by_household).sum()
    )
    size = by_household.value_counts().sort_index()

    heads = roster[relationship == HEAD_CODE]
    head_age = (
        pd.to_numeric(heads["s1q03a"], errors="coerce")
        .groupby(heads["household_id"])
        .first()
    )
    head_is_male = (
        code_of(heads["s1q02"]).eq(MALE_CODE).astype("Float64")
        .groupby(heads["household_id"])
        .first()
    )

    return frame_from(
        {
            "hh_size": size,
            "n_children": children,
            "n_elderly": elderly,
            "n_working_age": working,
            # Dependants per working-age adult. NA rather than inf where a
            # household has no working-age member at all -- a real and
            # meaningful situation that must not become a giant number.
            "dependency_ratio": safe_ratio(children + elderly, working),
            "head_age": head_age,
            "head_is_male": head_is_male,
            "share_female": (sex.eq(2)).groupby(by_household).mean(),
        }
    )

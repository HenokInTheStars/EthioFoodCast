"""Input validation for the prediction endpoint.

Without this, every malformed payload returned a confident answer. An empty
dict scored 0.6018 "Moderate" with `flagged=True` — a fabricated assessment
recommendation built from no information at all. A negative household size, a
consumption quintile of 47, an unknown region code and positive infinity were
all accepted silently, each shifting the number.

The rules below distinguish three kinds of problem, because they deserve
different treatment:

* **Caller errors** (unknown field names, wrong types, non-finite numbers)
  raise. These are bugs in whatever is calling, and quietly imputing past them
  hides the bug while still returning a number someone may act on.
* **Out-of-range values** raise by default. A quintile of 47 is not a household
  the model has ever seen, and extrapolating is worse than refusing.
* **Sparse input** does not raise — a partially filled form is legitimate — but
  the result is marked as low confidence and is not flagged for assessment.
"""

from __future__ import annotations

import math

import pandas as pd
from dataclasses import dataclass, field

# Below this many valid fields the model is mostly imputing its own training
# medians, so the answer describes the average household rather than this one.
MIN_FIELDS_FOR_BAND = 5

# Fields whose numbers are labels rather than quantities.
CATEGORICAL_FIELDS = {"w4_region", "cons_quintile"}

# Logical constraints that an observed range cannot express. A household of
# zero people is not a small household, and 2.5 people is not a household at
# all -- but both sit inside [1, 19] once a 20% tolerance is applied.
POSITIVE_INTEGER_FIELDS = {
    "hh_size", "n_children", "n_elderly", "n_working_age", "n_holders",
    "diet_n_groups", "diet_n_items", "econ_n_asset_types",
}
NON_NEGATIVE_FIELDS = {"dependency_ratio", "geo_dist_market", "geo_dist_road",
                       "land_total_area", "livestock_tlu", "crop_diversity"}
# Proportion-ness is read from the schema's observed range, never from the
# field name. Two attempts to infer it from names both failed: `_pct` caught
# `geo_slope_pct` (which runs 1 to 46) and rejected 78 of 100 real rows, and
# `_share` missed `share_female` and `geo_cropshare` because the word sits
# mid-name. The recorded range already says whether a variable lives in [0, 1].
PROPORTION_MAX = 1.0

# Columns a caller may legitimately carry alongside the features -- an upload
# usually keeps its own identifier. They are preserved, not scored.
METADATA_FIELDS = {"household_id", "surrogate_id", "ea_id", "holder_id",
                   "id", "name", "notes"}

# Values slightly outside the observed range are plausible measurement spread;
# far outside is a data-entry error. 20% of the observed span is the allowance.
RANGE_TOLERANCE = 0.20


class InvalidHousehold(ValueError):
    """Raised when a payload cannot be scored honestly."""


@dataclass
class ValidationResult:
    cleaned: dict
    metadata: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    n_valid: int = 0
    n_predictive: int = 0
    unknown_fields: list[str] = field(default_factory=list)

    @property
    def sufficient(self) -> bool:
        """Sufficiency counts only fields the MODEL uses.

        Four of the schema's fields exist solely to assign a vulnerability
        segment -- land area, livestock, crop diversity, irrigation. They never
        reach the model, so a payload of those four alone supplies zero
        predictive information while previously counting as four valid fields.
        """
        return self.n_predictive >= MIN_FIELDS_FOR_BAND


#: Returned when a value means "not supplied" rather than "malformed".
BLANK = object()


def _numeric(value):
    """Classify a value: a finite float, BLANK, or None for malformed.

    NaN is BLANK, not an error. A spreadsheet with an empty cell produces NaN
    the moment pandas reads it, and rejecting that would make every partially
    filled upload unscoreable. Infinity is a different matter -- it is a real
    value that is simply impossible, so it stays an error.
    """
    if value is None:
        return BLANK
    # pandas.NA, pandas.NaT and numpy masked values all mean "missing" and
    # all raise on float(). They are blanks, not malformed input.
    try:
        if pd.isna(value):
            return BLANK
    except (TypeError, ValueError):
        pass  # pd.isna raises on list-likes; those are handled below
    if isinstance(value, (list, tuple, dict, set)):
        return None
    if isinstance(value, bool):
        return float(value)
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number):
        return BLANK
    return None if math.isinf(number) else number


def validate(
    household: dict,
    schema: list[dict],
    *,
    strict: bool = True,
) -> ValidationResult:
    """Check a payload against the generated feature schema.

    `strict=False` downgrades every error to a warning and drops the offending
    field, for callers that would rather score a messy row than reject it.
    Nothing is ever silently accepted: dropped fields always appear in
    `warnings`.
    """
    if not isinstance(household, dict):
        raise InvalidHousehold(
            f"expected a dict of field -> value, got {type(household).__name__}"
        )

    known = {entry["name"]: entry for entry in schema}
    cleaned: dict = {}
    warnings: list[str] = []
    problems: list[str] = []

    metadata = {k: v for k, v in household.items() if k in METADATA_FIELDS}
    unknown = [
        name for name in household
        if name not in known and name not in METADATA_FIELDS
    ]
    if unknown:
        message = (
            f"unknown field(s) {sorted(unknown)[:5]} — check the spelling against "
            "input_schema(); unrecognised fields are ignored, so a typo silently "
            "removes real information"
        )
        problems.append(message) if strict else warnings.append(message)

    for name, raw in household.items():
        if name not in known:
            continue
        if raw is None:
            continue  # an intentional blank; the imputer handles it

        number = _numeric(raw)
        if number is BLANK:
            continue  # blank cell or explicit NaN: simply not supplied
        if number is None:
            message = f"{name}: {raw!r} is not a usable number"
            problems.append(message) if strict else warnings.append(message)
            continue

        entry = known[name]

        # Category codes are labels, not quantities. Region 2.5 is not a
        # region, and a binary flag of 0.5 is not an answer -- both were
        # previously accepted and shifted the score.
        if entry.get("dtype") == "binary" or name in CATEGORICAL_FIELDS:
            if number != int(number):
                message = (
                    f"{name}: {number:g} is not a whole number, but this field "
                    "is a category code rather than a quantity"
                )
                problems.append(message) if strict else warnings.append(message)
                continue
            allowed = entry.get("allowed_values")
            if allowed and int(number) not in allowed:
                message = (
                    f"{name}: {int(number)} is not a recognised code "
                    f"(expected one of {sorted(allowed)[:12]})"
                )
                problems.append(message) if strict else warnings.append(message)
                continue

        # Logical constraints first: a range check cannot catch a household
        # of 0 or 2.5 people, because both fall inside the observed span.
        if name in POSITIVE_INTEGER_FIELDS:
            if number != int(number) or number < (0 if name != "hh_size" else 1):
                minimum = 1 if name == "hh_size" else 0
                message = (
                    f"{name}: {number:g} must be a whole number of at least "
                    f"{minimum}"
                )
                problems.append(message) if strict else warnings.append(message)
                continue
        elif name in NON_NEGATIVE_FIELDS and number < 0:
            message = f"{name}: {number:g} cannot be negative"
            problems.append(message) if strict else warnings.append(message)
            continue
        elif (
            entry.get("min") is not None
            and entry.get("max") is not None
            and entry["min"] >= 0
            and entry["max"] <= PROPORTION_MAX
            and not 0 <= number <= PROPORTION_MAX
        ):
            message = f"{name}: {number:g} is a proportion and must lie in [0, 1]"
            problems.append(message) if strict else warnings.append(message)
            continue

        low, high = entry.get("min"), entry.get("max")
        if low is not None and high is not None:
            span = (high - low) or 1.0
            allowance = RANGE_TOLERANCE * span
            if not (low - allowance) <= number <= (high + allowance):
                message = (
                    f"{name}: {number:g} is outside the observed range "
                    f"[{low:g}, {high:g}] — the model has not seen values here"
                )
                problems.append(message) if strict else warnings.append(message)
                continue

        cleaned[name] = number

    if problems:
        raise InvalidHousehold("; ".join(problems))

    # Fields marked `used_for == "cluster"` feed the segment assigner only.
    predictive = [
        name for name in cleaned
        if known[name].get("used_for", "model") == "model"
    ]

    result = ValidationResult(
        metadata=metadata,
        cleaned=cleaned,
        warnings=warnings,
        n_valid=len(cleaned),
        n_predictive=len(predictive),
        unknown_fields=sorted(unknown),
    )

    if not result.sufficient:
        segmentation_only = result.n_valid - result.n_predictive
        detail = (
            f" ({segmentation_only} of them are segmentation-only fields that "
            "the model does not use)" if segmentation_only else ""
        )
        result.warnings.append(
            f"only {result.n_predictive} predictive field(s) supplied{detail}; "
            f"at least {MIN_FIELDS_FOR_BAND} are needed for a meaningful score. "
            "No probability is reported: the remaining features would fall back "
            "to training medians, so any number would describe an average "
            "household rather than this one."
        )

    return result

"""Input validation for the prediction endpoint.

Before this existed, every malformed payload returned a confident answer. An
empty dict scored 0.6018 "Moderate" with flagged=True — an assessment
recommendation manufactured from nothing.
"""

from __future__ import annotations

import pytest

from ethiofoodcast.contracts.validation import (
    MIN_FIELDS_FOR_BAND,
    InvalidHousehold,
    validate,
)

SCHEMA = [
    {"name": "hh_size", "dtype": "numeric", "min": 1, "max": 19,
     "median_default": 5, "allowed_values": None},
    {"name": "cons_quintile", "dtype": "numeric", "min": 1, "max": 5,
     "median_default": 3, "allowed_values": [1, 2, 3, 4, 5]},
    {"name": "w4_region", "dtype": "numeric", "min": 2, "max": 15,
     "median_default": 4, "allowed_values": [2, 3, 4, 7, 13, 15]},
    {"name": "prior_fi_any", "dtype": "binary", "min": 0, "max": 1,
     "median_default": 1, "allowed_values": [0, 1]},
    {"name": "dependency_ratio", "dtype": "numeric", "min": 0, "max": 6,
     "median_default": 1.2, "allowed_values": None},
    {"name": "diet_n_groups", "dtype": "numeric", "min": 0, "max": 9,
     "median_default": 4, "allowed_values": None},
]


def test_valid_payload_passes():
    result = validate({"hh_size": 6, "cons_quintile": 2}, SCHEMA)
    assert result.cleaned == {"hh_size": 6.0, "cons_quintile": 2.0}
    assert result.n_valid == 2


def test_unknown_field_names_are_rejected():
    """A typo silently removes real information, so it must not pass quietly."""
    with pytest.raises(InvalidHousehold, match="unknown field"):
        validate({"banana": 5}, SCHEMA)


def test_non_numeric_values_are_rejected():
    for bad in ("very poor", [1, 2, 3], {"a": 1}):
        with pytest.raises(InvalidHousehold, match="not a usable number"):
            validate({"hh_size": bad}, SCHEMA)


def test_infinity_is_rejected():
    """Infinity is a real value that is simply impossible."""
    for bad in (float("inf"), float("-inf")):
        with pytest.raises(InvalidHousehold, match="not a usable number"):
            validate({"hh_size": bad}, SCHEMA)


def test_nan_is_a_blank_not_an_error():
    """A spreadsheet's empty cell becomes NaN the moment pandas reads it.

    Rejecting it would make every partially filled upload unscoreable.
    """
    result = validate({"hh_size": 6, "cons_quintile": float("nan")}, SCHEMA)
    assert result.cleaned == {"hh_size": 6.0}
    assert result.n_valid == 1


def test_out_of_range_values_are_rejected():
    """A billion-person household is a data-entry error."""
    with pytest.raises(InvalidHousehold, match="outside the observed range"):
        validate({"hh_size": 1e9}, SCHEMA)
    with pytest.raises(InvalidHousehold, match="outside the observed range"):
        validate({"dependency_ratio": 40}, SCHEMA)


def test_logical_constraints_catch_what_ranges_cannot():
    """0, -0.1 and 2.5 people all sit inside [1, 19] once tolerance applies."""
    for impossible in (0, -0.1, 2.5):
        with pytest.raises(InvalidHousehold, match="whole number of at least"):
            validate({"hh_size": impossible}, SCHEMA)


def test_metadata_columns_pass_through_without_being_scored():
    """An upload usually carries its own identifier column."""
    result = validate({"household_id": "010101", "hh_size": 6}, SCHEMA)
    assert result.metadata == {"household_id": "010101"}
    assert result.cleaned == {"hh_size": 6.0}
    assert result.n_valid == 1, "an identifier is not predictive information"


def test_unrecognised_category_codes_are_rejected():
    """Region 999 sits inside numeric bounds; bounds are the wrong tool here."""
    with pytest.raises(InvalidHousehold, match="not a recognised code"):
        validate({"w4_region": 999}, SCHEMA)
    with pytest.raises(InvalidHousehold, match="not a recognised code"):
        validate({"cons_quintile": 47}, SCHEMA)


def test_fractional_category_codes_are_rejected():
    """Region 2.5 is not a region; a binary flag of 0.5 is not an answer."""
    with pytest.raises(InvalidHousehold, match="not a whole number"):
        validate({"w4_region": 2.5}, SCHEMA)
    with pytest.raises(InvalidHousehold, match="not a whole number"):
        validate({"prior_fi_any": 0.5}, SCHEMA)


def test_explicit_none_is_an_intentional_blank():
    result = validate({"hh_size": 6, "cons_quintile": None}, SCHEMA)
    assert "cons_quintile" not in result.cleaned
    assert result.n_valid == 1


def test_sparse_input_is_allowed_but_marked_insufficient():
    """A partly filled form is legitimate; pretending it is complete is not."""
    result = validate({"hh_size": 6}, SCHEMA)
    assert not result.sufficient
    assert any("predictive field" in w for w in result.warnings)


def test_enough_fields_is_sufficient():
    payload = {entry["name"]: entry["median_default"]
               for entry in SCHEMA[:MIN_FIELDS_FOR_BAND]}
    assert validate(payload, SCHEMA).sufficient


def test_non_strict_mode_warns_instead_of_raising():
    result = validate({"hh_size": 1e9, "cons_quintile": 2}, SCHEMA, strict=False)
    assert "hh_size" not in result.cleaned, "the bad field is dropped, not kept"
    assert result.cleaned == {"cons_quintile": 2.0}
    assert any("outside the observed range" in w for w in result.warnings)


def test_a_non_dict_payload_is_rejected():
    with pytest.raises(InvalidHousehold, match="expected a dict"):
        validate([1, 2, 3], SCHEMA)


def test_count_reflects_usable_values_not_keys_present():
    """An all-NaN payload previously reported 71 features supplied."""
    result = validate(
        {"hh_size": None, "cons_quintile": None}, SCHEMA, strict=False
    )
    assert result.n_valid == 0


def test_segmentation_only_fields_do_not_count_toward_sufficiency():
    """Four schema fields feed the segment assigner, never the model.

    A payload of only those supplies zero predictive information while
    previously counting as four valid fields.
    """
    schema = SCHEMA + [
        {"name": "land_total_area", "dtype": "numeric", "min": 0, "max": 1e5,
         "median_default": 1000, "allowed_values": None, "used_for": "cluster"},
        {"name": "livestock_tlu", "dtype": "numeric", "min": 0, "max": 83,
         "median_default": 2, "allowed_values": None, "used_for": "cluster"},
    ]
    for entry in schema:
        entry.setdefault("used_for", "model")

    result = validate({"land_total_area": 1200, "livestock_tlu": 2}, schema)
    assert result.n_valid == 2
    assert result.n_predictive == 0
    assert not result.sufficient
    assert any("segmentation-only" in w for w in result.warnings)


def test_percentage_fields_are_not_treated_as_fractions():
    """A name suffix is the wrong way to infer a variable's scale.

    `geo_slope_pct` runs 1 to 46, so a [0, 1] rule rejected the field's own
    default and 78 of 100 real survey rows.
    """
    schema = SCHEMA + [
        {"name": "geo_slope_pct", "dtype": "numeric", "min": 1, "max": 46,
         "median_default": 13, "allowed_values": None, "used_for": "model"},
    ]
    result = validate({"geo_slope_pct": 13}, schema)
    assert result.cleaned == {"geo_slope_pct": 13.0}


def test_genuine_proportions_are_still_bounded():
    schema = SCHEMA + [
        {"name": "land_share_irrigated", "dtype": "numeric", "min": 0, "max": 1,
         "median_default": 0.0, "allowed_values": None, "used_for": "model"},
    ]
    validate({"land_share_irrigated": 0.4}, schema)
    with pytest.raises(InvalidHousehold, match="proportion"):
        validate({"land_share_irrigated": 4}, schema)


def test_pandas_missing_values_are_blanks():
    """pd.NA and pd.NaT mean missing and both raise on float()."""
    import pandas as pd

    for blank in (pd.NA, pd.NaT, None, float("nan")):
        result = validate({"hh_size": blank, "cons_quintile": 2}, SCHEMA)
        assert result.n_valid == 1, f"{blank!r} should be a blank"


def test_real_survey_rows_validate():
    """Validation must accept the data the model was trained on."""
    import pandas as pd

    from ethiofoodcast.config import paths

    path = paths.PROCESSED_DIR / "features.parquet"
    if not path.exists():
        pytest.skip("features not built")

    from ethiofoodcast.serving.api import BUNDLE_PATH
    from ethiofoodcast.serving.bundle import load

    if not BUNDLE_PATH.exists():
        pytest.skip("artifacts not built")

    schema = load(BUNDLE_PATH).schema
    names = [entry["name"] for entry in schema]
    frame = pd.read_parquet(path)
    rows = frame[frame["in_modelling_sample"] == 1].head(50)

    for _, row in rows.iterrows():
        payload = {n: row[n] for n in names if n in row.index and pd.notna(row[n])}
        validate(payload, schema)

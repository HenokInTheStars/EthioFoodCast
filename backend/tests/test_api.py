"""The Streamlit-facing service contract.

These tests exist so a frontend can rely on the shapes without reading the
modelling code. They skip when the artifacts have not been built.
"""

from __future__ import annotations

import pandas as pd
import pytest

from ethiofoodcast.serving.api import BUNDLE_PATH, ArtifactsMissing, Service

pytestmark = pytest.mark.skipif(
    not BUNDLE_PATH.exists(),
    reason="model artifacts missing from backend/artifacts/",
)


@pytest.fixture(scope="module")
def service():
    return Service()


def test_missing_artifacts_give_an_actionable_message(tmp_path):
    with pytest.raises(ArtifactsMissing, match="git checkout -- backend/artifacts"):
        Service(bundle_path=tmp_path / "absent.joblib")


def test_schema_is_grouped_and_complete(service):
    grouped = service.input_schema()
    assert grouped, "schema must not be empty"

    for group, fields in grouped.items():
        assert isinstance(group, str) and group
        for field in fields:
            assert {"name", "dtype", "min", "max", "median_default"} <= set(field)
            assert field["dtype"] in {"numeric", "binary"}


def test_short_form_is_a_usable_size(service):
    """A real intake form cannot ask 74 questions."""
    short = sum(len(v) for v in service.input_schema(short_form=True).values())
    full = sum(len(v) for v in service.input_schema().values())
    assert 5 <= short <= 25
    assert short < full


def test_predict_returns_the_full_contract(service):
    result = service.predict(service.defaults(short_form=True))

    assert 0.0 <= result["probability"] <= 1.0
    assert result["risk_band"] in {"Low", "Moderate", "High"}
    assert isinstance(result["top_factors"], list)
    assert isinstance(result["recommendations"], list)
    assert result["caveats"], "a number must never be displayed without its limits"
    assert "git_sha" in result["model_version"]


def test_prediction_works_from_a_partial_form(service):
    """A form above the sufficiency gate scores; below it, no number is given."""
    sparse = service.predict({"cons_quintile": 2, "diet_n_groups": 3})
    assert sparse["probability"] is None, "too few predictive fields"

    dense = service.predict({
        "cons_quintile": 2, "diet_n_groups": 3, "hh_size": 6,
        "w4_region": 7, "dependency_ratio": 1.5, "prior_fi_any": 1,
    })
    assert 0.0 <= dense["probability"] <= 1.0


def test_empty_input_does_not_crash(service):
    """It must not crash -- and must not invent a number either."""
    result = service.predict({})
    assert result["probability"] is None
    assert result["risk_band"] == "Insufficient data"


def test_batch_is_sorted_by_risk(service):
    defaults = service.defaults(short_form=True)
    frame = pd.DataFrame([defaults, {**defaults, "cons_quintile": 1},
                          {**defaults, "cons_quintile": 5}])

    scored = service.predict_batch(frame)
    assert len(scored) == 3
    assert {"probability", "risk_band", "cluster"} <= set(scored.columns)
    assert scored["probability"].is_monotonic_decreasing, "assessment list order"


def test_capacity_plan_respects_the_limit(service):
    defaults = service.defaults(short_form=True)
    scored = service.predict_batch(pd.DataFrame([defaults] * 10))

    plan = service.capacity_plan(scored, capacity=3)
    assert plan["capacity"] == 3
    assert len(plan["selected"]) == 3
    assert plan["coverage_pct"] == 30.0


def test_capacity_plan_handles_an_oversized_request(service):
    defaults = service.defaults(short_form=True)
    scored = service.predict_batch(pd.DataFrame([defaults] * 3))

    plan = service.capacity_plan(scored, capacity=999)
    assert plan["capacity"] == 3, "cannot visit more households than exist"


def test_dashboard_payloads_are_renderable(service):
    assert service.risk_distribution()["band_counts"]
    assert not service.regional_summary().empty
    assert not service.clusters().empty
    assert not service.global_drivers().empty
    assert service.performance()["pr_auc"] > 0.5


def test_exported_sample_carries_no_identifiers(service):
    """A leaked export must not re-identify a surveyed household."""
    frame = service.scored_households()
    for column in ("household_id", "ea_id", "lat_mod", "lon_mod"):
        assert column not in frame.columns
    assert "surrogate_id" in frame.columns


def test_risk_bands_are_contiguous(service):
    bands = service.risk_bands()
    assert [b["label"] for b in bands] == ["Low", "Moderate", "High"]
    for earlier, later in zip(bands, bands[1:]):
        assert earlier["upper"] == later["lower"], "no gap between bands"


def test_empty_payload_is_not_flagged_for_assessment(service):
    """An empty form previously returned 0.6018 Moderate with flagged=True."""
    result = service.predict({})

    assert result["risk_band"] == "Insufficient data"
    assert result["flagged"] is False
    assert result["sufficient_data"] is False
    assert result["n_features_supplied"] == 0
    assert result["recommendations"] == [], "no data cannot justify an assessment"


def test_invalid_values_are_rejected_by_the_endpoint(service):
    from ethiofoodcast.contracts.validation import InvalidHousehold

    for payload in (
        {"hh_size": -5},
        {"w4_region": 999},
        {"w4_region": 2.5},
        {"cons_quintile": 47},
        {"geo_dist_market": float("inf")},
        {"hh_size": "big"},
        {"definitely_not_a_field": 1},
    ):
        with pytest.raises(InvalidHousehold):
            service.predict(payload)


def test_band_and_flag_are_distinct_and_explained(service):
    """Two households can share a band while only one crosses the threshold."""
    result = service.predict(service.defaults(short_form=True))

    assert "band_meaning" in result and "flag_meaning" in result
    assert result["flagged"] == (result["probability"] >= result["threshold"])
    assert f"{result['threshold']:.3f}" in result["flag_meaning"]


def test_sparse_input_scores_but_is_marked_insufficient(service):
    result = service.predict({"cons_quintile": 2, "hh_size": 6})

    assert result["risk_band"] == "Insufficient data"
    assert result["flagged"] is False
    assert result["warnings"], "the caller must be told why"


def test_insufficient_input_reports_no_probability_at_all(service):
    """A band is not warning enough once a number is on the screen."""
    result = service.predict({})

    assert result["probability"] is None
    assert result["risk_band"] == "Insufficient data"
    assert result["top_factors"] == []


def test_segmentation_only_payload_is_not_sufficient(service):
    payload = {
        entry["name"]: entry["median_default"]
        for entry in service.bundle.schema
        if entry.get("used_for") == "cluster" and entry["median_default"] is not None
    }
    result = service.predict(payload)

    assert result["n_predictive_supplied"] == 0
    assert result["sufficient_data"] is False
    assert result["probability"] is None


def test_threshold_metrics_come_from_validation_selection(service):
    performance = service.performance()
    assert "chosen on validation" in performance["evaluation"]
    assert performance["threshold"] == service.graph.threshold


def test_capacity_plan_sorts_its_own_input(service):
    """The batch path sorts; a hand-built frame does not."""
    unsorted = pd.DataFrame({"probability": [0.1, 0.9], "risk_band": ["Low", "High"]})
    plan = service.capacity_plan(unsorted, 1)
    assert plan["selected"]["probability"].tolist() == [0.9]


def test_capacity_plan_excludes_unscored_households(service):
    """An unscored row cannot be ranked, so it must not fill a visit slot."""
    mixed = pd.DataFrame({
        "probability": [0.8, None, 0.6],
        "risk_band": ["High", "Insufficient data", "Moderate"],
    })
    plan = service.capacity_plan(mixed, 2)

    assert plan["n_unscored"] == 1
    assert len(plan["unscored"]) == 1
    assert plan["selected"]["probability"].notna().all()
    assert plan["selected"]["probability"].tolist() == [0.8, 0.6]


def test_batch_tolerates_arbitrary_identifier_and_notes_columns(service):
    """A real upload carries columns an allowlist cannot anticipate."""
    valid = {"cons_quintile": 2, "hh_size": 6, "diet_n_groups": 3,
             "w4_region": 7, "dependency_ratio": 1.5, "prior_fi_any": 1}

    for extra in ("household_id", "hh_reference", "enumerator_notes", "kebele"):
        scored = service.predict_batch(pd.DataFrame([{extra: "X1", **valid}]))
        assert scored["probability"].notna().all(), f"{extra} broke scoring"


def test_top_quarter_precision_is_labelled_historical_not_expected(service):
    """It is one measurement at one coverage, not a forecast for this list."""
    scored = pd.DataFrame({"probability": [0.9, 0.8, 0.7, 0.6],
                           "risk_band": ["High"] * 4})
    plan = service.capacity_plan(scored, 1)

    assert "expected_precision" not in plan
    assert "historical_precision_at_25pct" in plan
    assert "historical benchmark" in plan["precision_note"]
    assert "not a prediction for this list" in plan["precision_note"]


def test_performance_declares_whether_evaluation_was_complete(service):
    performance = service.performance()
    assert "evaluation_complete" in performance
    assert performance["folds_used"] >= 1


def test_capacity_plan_always_returns_a_note(service):
    """A key present in only one branch makes every caller a conditional."""
    valid = {"cons_quintile": 2, "hh_size": 6, "diet_n_groups": 3,
             "w4_region": 7, "dependency_ratio": 1.5, "prior_fi_any": 1}

    clean = service.capacity_plan(service.predict_batch(pd.DataFrame([valid] * 2)), 1)
    assert "note" in clean and "precision_note" in clean

    mixed = service.capacity_plan(
        service.predict_batch(pd.DataFrame([valid, {"cons_quintile": 1}])), 1
    )
    assert "note" in mixed


def test_capacity_plan_on_an_entirely_unscored_upload(service):
    scored = service.predict_batch(pd.DataFrame([{"cons_quintile": 1}]))
    plan = service.capacity_plan(scored, 1)

    assert plan["n_rankable"] == 0
    assert plan["capacity"] == 0
    assert plan["mean_risk_selected"] is None, "no mean exists over nothing"
    assert len(plan["selected"]) == 0


def test_capacity_plan_on_an_empty_frame(service):
    empty = pd.DataFrame({"probability": [], "risk_band": []})
    plan = service.capacity_plan(empty, 5)

    assert plan["capacity"] == 0
    assert plan["coverage_pct"] == 0.0
    assert plan["mean_risk_selected"] is None

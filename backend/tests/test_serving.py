"""The UI contract: privacy, rules, and risk bands."""

from __future__ import annotations

import pandas as pd
import pytest

from ethiofoodcast.export.privacy import (
    anonymise,
    assert_safe,
    suppress_small_cells,
    surrogate_id,
)
from ethiofoodcast.rules.engine import evaluate, load_rules
from ethiofoodcast.serving.bundle import band_of

PADDED = "010101088800910007"


def test_surrogate_ids_are_stable_and_opaque():
    first, second = surrogate_id(PADDED), surrogate_id(PADDED)
    assert first == second, "the same household must map to the same key"
    assert PADDED not in first
    assert surrogate_id(PADDED) != surrogate_id("010101088800910017")


def test_anonymise_removes_every_identifier():
    frame = pd.DataFrame(
        {
            "household_id": [PADDED],
            "ea_id": ["EA1"],
            "lat_mod": [9.1],
            "lon_mod": [38.7],
            "probability": [0.7],
        }
    )
    out = anonymise(frame)

    assert_safe(out)
    assert "surrogate_id" in out.columns
    assert out["probability"].iloc[0] == 0.7


def test_assert_safe_catches_a_leak():
    with pytest.raises(ValueError, match="identifying columns"):
        assert_safe(pd.DataFrame({"household_id": [PADDED]}))
    with pytest.raises(ValueError, match="coordinate"):
        assert_safe(pd.DataFrame({"latitude": [9.1]}))


def test_small_cells_are_suppressed_but_stay_visible():
    """Dropping the row would make a map look complete when it is not."""
    frame = pd.DataFrame({"region": [1, 2], "n": [400, 7], "mean_risk": [0.6, 0.9]})
    out = suppress_small_cells(frame, "n", minimum=25)

    assert len(out) == 2, "the suppressed row must remain, marked"
    assert not out.loc[0, "suppressed"]
    assert out.loc[1, "suppressed"]
    assert out.loc[0, "mean_risk"] == 0.6
    assert pd.isna(out.loc[1, "mean_risk"])


def test_risk_bands_cover_the_whole_range():
    assert band_of(0.0) == "Low"
    assert band_of(0.44) == "Low"
    assert band_of(0.55) == "Moderate"
    assert band_of(0.95) == "High"
    assert band_of(1.0) == "High", "an exact 1.0 must not fall through the bands"


def test_rules_are_data_not_code():
    rules = load_rules()
    assert rules["version"] >= 1
    assert len(rules["rules"]) >= 5
    for rule in rules["rules"]:
        assert {"id", "when", "category", "prompt"} <= set(rule)


def test_rules_fire_on_the_right_conditions():
    triggered = evaluate({"land_any_irrigated": 0, "geo_dist_market": 55})
    categories = {r["category"] for r in triggered}

    assert "Irrigation or water-access assessment" in categories
    assert "Market-access or transport support" in categories


def test_a_missing_answer_never_invents_a_recommendation():
    """Absent data is not evidence that the condition holds."""
    assert evaluate({}) == []
    assert evaluate({"land_any_irrigated": None}) == []


def test_rules_do_not_fire_when_the_condition_is_not_met():
    triggered = evaluate({"land_any_irrigated": 1, "geo_dist_market": 2})
    assert not any(r["id"] in ("no_irrigation", "market_distance") for r in triggered)


def test_bundle_carries_its_own_threshold():
    """The operating point is part of the model, not a UI setting."""
    from ethiofoodcast.serving.api import BUNDLE_PATH
    from ethiofoodcast.serving.bundle import load

    if not BUNDLE_PATH.exists():
        pytest.skip("artifacts not built")

    bundle = load(BUNDLE_PATH)
    assert 0.0 < bundle.threshold < 1.0

    # Enough fields to clear the sufficiency gate: below it the result is
    # deliberately never flagged, whatever the probability.
    dense = {entry["name"]: entry["median_default"]
             for entry in bundle.schema[:8] if entry["median_default"] is not None}
    result = bundle.predict(dense)

    assert result["threshold"] == bundle.threshold
    assert result["sufficient_data"]
    assert result["flagged"] == (result["probability"] >= bundle.threshold)

    sparse = bundle.predict({"cons_quintile": 1})
    assert sparse["flagged"] is False, "too little data must never flag"


def test_dashboard_metrics_are_derived_not_transcribed():
    """Hard-coded numbers drift from the model they claim to describe."""
    import json
    from pathlib import Path
    from ethiofoodcast.serving.api import Service

    service = Service()
    verification = json.loads((Path(__file__).resolve().parents[1] / "reports/graph_serving/verification.json").read_text())
    performance = service.performance()

    # The dashboard's numbers are the export's own verification record and the model's metadata.
    assert performance["accuracy"] == verification["metrics"]["accuracy"]
    assert performance["pr_auc"] == verification["metrics"]["pr_auc"]
    assert performance["threshold"] == service.graph.threshold
    assert performance["five_split"]["accuracy_mean"] == service.graph.metadata["five_split_mean_accuracy"]

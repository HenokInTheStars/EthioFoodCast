"""Verify the public import path used by the independent Streamlit app."""
import importlib.util
from pathlib import Path
import pandas as pd


def test_public_backend_contract():
    path = Path(__file__).resolve().parents[1] / "backend.py"
    spec = importlib.util.spec_from_file_location("handoff_backend", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    service = module.Service()
    assert service.input_schema(short_form=True)
    assert service.predict({})["probability"] is None
    answers = {"w4_region": 7, "hh_size": 5, "cons_quintile": 2,
               "prior_fi_any": 1, "prior_fi_score": 2, "diet_n_groups": 3}  # 5 answers; region alone does not count
    prediction = service.predict(answers)
    assert prediction["sufficient_data"]
    assert 0 <= prediction["probability"] <= 1
    scored = service.predict_batch(pd.DataFrame([{**answers, "household_id": "001"}]))
    assert scored.iloc[0]["household_id"] == "001"
    assert scored.iloc[0]["probability"] == prediction["probability"]
    assert service.capacity_plan(scored, 1)["capacity"] == 1

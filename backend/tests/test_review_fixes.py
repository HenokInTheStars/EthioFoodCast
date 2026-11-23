"""Regression tests for the review findings: impossible answers, sufficiency,
explanation consistency and model identity in the web workflow."""
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

import api_server
from ethiofoodcast.contracts.validation import InvalidHousehold
from ethiofoodcast.serving.derive import DERIVED, derive

COPE = dict(prior_fi_cope_less_preferred=3, prior_fi_cope_limit_variety=2, prior_fi_cope_limit_portion=1,
            prior_fi_cope_fewer_meals=0, prior_fi_cope_restrict_adult=1, prior_fi_cope_borrow_food=2,
            prior_fi_cope_no_food=0, prior_fi_cope_whole_day=1)


@pytest.fixture(scope='module')
def service():
    return api_server.svc


def test_impossible_answers_are_rejected(service):
    area = service.areas()[0]
    ok = {'area_id': area['id'], 'hh_size': 4, **{'n_children': 3, 'n_working_age': 2, 'n_elderly': 1, 'land_total_area': 4000, 'land_any_irrigated': 0, 'crop_diversity': 3, 'crop_any_damage': 1, 'harvest_any_shortfall': 0, 'livestock_cattle': 2, 'livestock_small_ruminants': 5, 'livestock_poultry': 6, 'econ_has_nonfarm_business': 0, 'econ_psnp': 1, 'econ_total_assets': 5}}
    for bad in ({'prior_fi_cope_borrow_food': 8}, {'prior_fi_cope_borrow_food': 2.5},
                {'n_children': 3, 'n_elderly': 1, 'n_working_age': 2},       # 6 members in a household of 4
                {'econ_n_asset_types': 5, 'econ_total_assets': 2}):
        with pytest.raises(InvalidHousehold):
            service.predict({**ok, **bad})
    assert service.predict({**ok, 'n_children': 2, 'n_elderly': 0, 'n_working_age': 2})['probability'] is not None


def test_summaries_and_region_do_not_count_towards_sufficiency(service):
    area = service.areas()[0]
    three = {'area_id': area['id'], 'w4_region': area['region'], 'is_agricultural': 1,
             'n_children': 2, 'land_total_area': 3000, 'livestock_cattle': 1}
    result = service.predict(three)
    assert result['probability'] is None and result['n_predictive_supplied'] == 3


def test_sensitivity_withholds_an_answer_together_with_its_summaries(service):
    area, index = service.areas()[0], 0
    own = {'n_children': 3, 'n_working_age': 2, 'n_elderly': 1, 'land_total_area': 4000, 'land_any_irrigated': 0, 'crop_diversity': 3, 'crop_any_damage': 1, 'harvest_any_shortfall': 0, 'livestock_cattle': 2, 'livestock_small_ruminants': 5, 'livestock_poultry': 6, 'econ_has_nonfarm_business': 0, 'econ_psnp': 1, 'econ_total_assets': 5}
    factors = service.graph.factors(own, index, top_n=99, derive_fn=derive)
    names = {f['source_field'] for f in factors}
    assert not names & (set(DERIVED) - set(own)) and 'area_context' in names   # only real answers are explained
    frame = lambda a: pd.DataFrame([derive(a)]).reindex(columns=service.graph.features)
    base = service.graph.scores(frame(own), np.array([index]))[0]
    # Withholding the number of children must also recalculate household size, the dependency
    # ratio and the per-person land and livestock values.
    without = {k: v for k, v in own.items() if k != 'n_children'}
    expected = base - service.graph.scores(frame(without), np.array([index]))[0]
    got = next(f['contribution'] for f in factors if f['source_field'] == 'n_children')
    assert got == pytest.approx(expected, abs=1e-4)


def test_area_effect_is_against_the_average_prediction_over_real_areas(service):
    own = {'n_children': 3, 'n_working_age': 2, 'n_elderly': 1, 'land_total_area': 4000, 'land_any_irrigated': 0, 'crop_diversity': 3, 'crop_any_damage': 1, 'harvest_any_shortfall': 0, 'livestock_cattle': 2, 'livestock_small_ruminants': 5, 'livestock_poultry': 6, 'econ_has_nonfarm_business': 0, 'econ_psnp': 1, 'econ_total_assets': 5}
    factor = next(f for f in service.graph.factors(own, 0, top_n=99) if f['source_field'] == 'area_context')
    frame = pd.DataFrame([own]).reindex(columns=service.graph.features)
    everywhere = pd.concat([frame] * len(service.areas()), ignore_index=True)
    everywhere['w4_region'] = [a['region'] for a in service.areas()]
    here = service.graph.scores(frame, np.array([0]))[0]
    average = service.graph.scores(everywhere, np.arange(len(service.areas()))).mean()
    assert factor['contribution'] == pytest.approx(here - average, abs=1e-4)


def test_web_predict_requires_a_survey_area_and_reports_the_gcn():
    client = TestClient(api_server.app)
    response = client.post('/api/predict', json={'hh_size': 5, 'cons_quintile': 2, 'diet_n_groups': 3,
                                                  'prior_fi_s8q01': 1, 'geo_dist_market': 20})
    assert response.status_code == 422 and 'area' in response.json()['detail'].lower()
    assert client.get('/api/meta').json()['version']['model'] == 'gcn_plus_ensemble'


def test_summaries_for_other_model_versions_never_break_a_prediction(service):
    # land_area_per_person and wub_fes_points are calculable from these answers but belong to another
    # model version; they must be dropped, not rejected as unknown fields.
    area = service.areas()[0]
    row = {'area_id': area['id'], 'hh_size': 6, 'land_total_area': 2500, 'cons_food_share': 0.7,
           'livestock_tlu': 1.2, **{'n_children': 3, 'n_working_age': 2, 'n_elderly': 1, 'land_total_area': 4000, 'land_any_irrigated': 0, 'crop_diversity': 3, 'crop_any_damage': 1, 'harvest_any_shortfall': 0, 'livestock_cattle': 2, 'livestock_small_ruminants': 5, 'livestock_poultry': 6, 'econ_has_nonfarm_business': 0, 'econ_psnp': 1, 'econ_total_assets': 5}}
    result = service.predict(row)
    assert result['probability'] is not None
    # hh_size and cons_food_share are real survey questions this short-form model does not use:
    # they are set aside with a warning, never rejected.
    assert any('set aside' in w for w in result['warnings'])


def test_typos_are_still_rejected_but_legacy_path_uses_its_own_schema(service):
    area = service.areas()[0]
    with pytest.raises(InvalidHousehold):
        service.predict({'area_id': area['id'], 'hh_sise': 5, **{'n_children': 3, 'n_working_age': 2, 'n_elderly': 1, 'land_total_area': 4000, 'land_any_irrigated': 0, 'crop_diversity': 3, 'crop_any_damage': 1, 'harvest_any_shortfall': 0, 'livestock_cattle': 2, 'livestock_small_ruminants': 5, 'livestock_poultry': 6, 'econ_has_nonfarm_business': 0, 'econ_psnp': 1, 'econ_total_assets': 5}})
    legacy = {'w4_region': 7, 'hh_size': 5, 'cons_quintile': 2, 'prior_fi_any': 1, 'prior_fi_score': 2, 'diet_n_groups': 3}
    assert service.predict(legacy)['probability'] is not None      # no area: ExtraTrees and its 5-answer rule


def test_form_needs_nine_of_its_fourteen_answers(service):
    area = service.areas()[0]
    short = {'n_children': 3, 'n_working_age': 2, 'n_elderly': 1, 'land_total_area': 4000, 'land_any_irrigated': 0, 'crop_diversity': 3, 'crop_any_damage': 1, 'harvest_any_shortfall': 0, 'livestock_cattle': 2, 'livestock_small_ruminants': 5, 'livestock_poultry': 6, 'econ_has_nonfarm_business': 0, 'econ_psnp': 1, 'econ_total_assets': 5}
    assert service.graph.metadata['min_answers'] == 9 and len(short) == 14
    eight = dict(list(short.items())[:8])
    nine = dict(list(short.items())[:9])
    assert service.predict({'area_id': area['id'], **eight})['probability'] is None
    assert service.predict({'area_id': area['id'], **nine})['probability'] is not None


SHORT = {'n_children': 3, 'n_working_age': 2, 'n_elderly': 1, 'land_total_area': 4000, 'land_any_irrigated': 0, 'crop_diversity': 3, 'crop_any_damage': 1, 'harvest_any_shortfall': 0, 'livestock_cattle': 2, 'livestock_small_ruminants': 5, 'livestock_poultry': 6, 'econ_has_nonfarm_business': 0, 'econ_psnp': 1, 'econ_total_assets': 5}


def test_segment_questions_set_the_segment_but_not_the_estimate(service):
    area = service.areas()[0]
    base = {'area_id': area['id'], **SHORT}
    # Food-history and diet answers are optional in the agricultural form: segment and prompts only.
    farm = {**base, 'prior_fi_s8q01': 1, 'prior_fi_s8q06': 1, 'diet_cereals': 1, 'diet_dairy': 0, 'econ_credit_refused': 1}
    a, b = service.predict(base), service.predict(farm)
    assert a['probability'] == b['probability']
    assert b['cluster'] is not None

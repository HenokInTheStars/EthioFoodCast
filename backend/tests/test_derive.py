"""Summaries are computed from answerable questions with the training rules."""
import pytest
from ethiofoodcast.serving.derive import derive, DERIVED
from ethiofoodcast.serving.api import Service

COPE = dict(prior_fi_cope_less_preferred=3, prior_fi_cope_limit_variety=2, prior_fi_cope_limit_portion=1,
            prior_fi_cope_fewer_meals=0, prior_fi_cope_restrict_adult=1, prior_fi_cope_borrow_food=2,
            prior_fi_cope_no_food=0, prior_fi_cope_whole_day=1)


def test_coping_summaries_match_training_formulas():
    out = derive(COPE)
    assert out['prior_fi_rcsi'] == 3 * 1 + 2 * 2 + 1 * 1 + 1 * 3 + 0 * 1          # published rCSI weights
    assert out['prior_fi_coping_days'] == 10 and out['prior_fi_coping_breadth'] == 6
    assert out['prior_fi_coping_max'] == 3 and out['prior_fi_coping_severe_days'] == 1
    assert out['prior_fi_coping_severe_any'] == 1 and out['prior_fi_days'] == 3


def test_partial_answers_stay_missing_and_supplied_values_win():
    partial = {k: v for k, v in COPE.items() if k != 'prior_fi_cope_borrow_food'}
    out = derive(partial)
    assert 'prior_fi_rcsi' not in out and 'prior_fi_coping_days' not in out
    assert derive({**COPE, 'prior_fi_rcsi': 5})['prior_fi_rcsi'] == 5


def test_yes_answers_and_dependency_ratio():
    assert derive({'prior_fi_s8q06': 1})['prior_fi_any'] == 1 and 'prior_fi_score' not in derive({'prior_fi_s8q06': 1})
    out = derive({'prior_fi_s8q01': 0, 'prior_fi_s8q04': 1, 'prior_fi_s8q06': 1})
    assert out['prior_fi_any'] == 1 and out['prior_fi_score'] == 2
    assert derive({'prior_fi_s8q01': 0, 'prior_fi_s8q04': 0, 'prior_fi_s8q06': 0})['prior_fi_any'] == 0
    assert derive({'n_children': 3, 'n_elderly': 1, 'n_working_age': 2})['dependency_ratio'] == 2
    assert 'dependency_ratio' not in derive({'n_children': 3, 'n_elderly': 1, 'n_working_age': 0})


@pytest.fixture(scope='module')
def service():
    return Service()


def test_form_never_asks_for_a_summary_but_asks_its_questions(service):
    schema = {f['name'] for f in service.graph.schema}
    calculable = {k for k, sources in DERIVED.items() if all(s in schema for s in sources)}
    for short in (True, False):
        names = {f['name'] for fields in service.graph_form(short).values() for f in fields}
        assert not names & calculable                                   # calculated, so never asked
        assert not {n for n in names if n.startswith('geo_')}          # location is never asked
        assert not names & service.NOT_ASKED
    full = {f['name'] for fields in service.graph_form(False).values() for f in fields}
    # Segment summaries are asked through their questions (animals by type, people by age), never as a score.
    assert 'livestock_tlu' not in full and 'dependency_ratio' not in full
    assert {'livestock_cattle', 'livestock_small_ruminants', 'n_children', 'n_working_age'} <= full
    assert 'hh_size' not in full and 'livestock_tlu_per_person' not in full and 'land_area_per_person' not in full
    short = {f['name'] for fields in service.graph_form(True).values() for f in fields}
    # The main form is exactly the answers the deployed model was trained on.
    assert short == set(service.graph.metadata['answers'])


def test_prediction_from_questions_equals_prediction_from_summaries(service):
    area = service.areas()[0]
    base = {'area_id': area['id'], 'w4_region': area['region'], 'hh_size': 5, 'cons_quintile': 2,
            'prior_fi_s8q01': 1, 'prior_fi_s8q04': 1, 'prior_fi_s8q06': 0, **COPE}
    explicit = {**base, **{k: v for k, v in derive(base).items() if k in DERIVED}}
    assert service.predict(base)['probability'] == service.predict(explicit)['probability']

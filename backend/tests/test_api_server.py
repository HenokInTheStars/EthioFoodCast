"""HTTP wrapper and graph dashboard artifacts used by the web demo."""
import pytest
from fastapi.testclient import TestClient

import api_server


@pytest.fixture(scope='module')
def client():
    return TestClient(api_server.app)


def test_meta_and_schema(client):
    meta = client.get('/api/meta').json()
    assert {r['name'] for r in meta['regions']} >= {'Amhara', 'Oromia', 'SNNP'}
    assert meta['field_labels']['area_context'].startswith('Neighbourhood') and meta['field_help']['area_context']
    short, full = client.get('/api/schema').json(), client.get('/api/schema?full=true').json()
    assert 0 < sum(map(len, short.values())) < sum(map(len, full.values()))


def test_predict_returns_gcn_result_with_explanations(client):
    area = client.get('/api/areas?region=7').json()[0]
    body = {'area_id': area['id'], **{'n_children': 3, 'n_working_age': 2, 'n_elderly': 1, 'land_total_area': 4000, 'land_any_irrigated': 0, 'crop_diversity': 3, 'crop_any_damage': 1, 'harvest_any_shortfall': 0, 'livestock_cattle': 2, 'livestock_small_ruminants': 5, 'livestock_poultry': 6, 'econ_has_nonfarm_business': 0, 'econ_psnp': 1, 'econ_total_assets': 5}}
    result = client.post('/api/predict', json=body).json()
    assert result['model_version']['model'] == 'gcn_plus_ensemble'
    assert 0 <= result['probability'] <= 1 and result['top_factors']
    assert result == api_server.clean(api_server.svc.predict(body))


def test_invalid_household_is_a_422_with_the_reason(client):
    response = client.post('/api/predict', json={'area_id': 'unknown', 'hh_size': 5})
    assert response.status_code == 422 and 'area_id' in response.json()['detail']


def test_dashboard_endpoints_are_consistent(client):
    overview = client.get('/api/overview').json()
    regional = {r['region']: r for r in overview['regional']}
    assert regional['Tigray']['suppressed'] and all(r['n'] >= 25 for r in regional.values() if not r['suppressed'])
    assert [m['key'] for m in overview['comparison']['models']][0] == 'gcn_plus_ensemble'
    assert len(overview['comparison']['models']) == 4
    dist = overview['risk_distribution']
    assert sum(dist['band_counts'].values()) == dist['n_households'] == sum(dist['histogram']['counts'])


def test_planning_filters_and_never_exports_identifiers(client):
    plan = client.get('/api/planning?region=4&flagged_only=true&capacity=10').json()
    rows = plan['selected']
    assert len(rows) <= 10 and all(r['region_code'] == 4 and r['flagged'] for r in rows)
    assert [r['probability'] for r in rows] == sorted((r['probability'] for r in rows), reverse=True)
    forbidden = {'household_id', 'ea_id', 'lat_mod', 'lon_mod', '_observed', 'food_insecure'}
    assert not forbidden & set(rows[0])


def test_segments_and_figures(client):
    segments = client.get('/api/segments').json()
    assert len(segments['profiles']) == len(segments['clusters']) == 5
    assert client.get('/figures/graph_model/model_comparison_4.png').status_code == 200
    assert client.get('/figures/02_target_balance.png').status_code == 200


def test_every_form_field_has_a_plain_label_and_help():
    labels, help_text = api_server.svc.field_labels(), api_server.svc.field_help()
    names = {f['name'] for f in api_server.svc.graph.schema} | {'area_context'}
    assert names <= set(labels) and names <= set(help_text)
    for name in names:
        assert 's8q' not in labels[name] and '_' not in labels[name], labels[name]
        assert len(help_text[name]) > 20

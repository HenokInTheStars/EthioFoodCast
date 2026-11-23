"""Backward compatibility and graph-serving behaviour for the Streamlit API."""
import numpy as np
import pandas as pd
import pytest
from ethiofoodcast.serving.api import Service
from ethiofoodcast.contracts.validation import InvalidHousehold

@pytest.fixture(scope='module')
def service():
    svc=Service()
    assert svc.graph is not None, 'Export graph_serving.joblib first'
    return svc


# The deployed graph model is the validated 16-question short form; it needs at least 10 of them.
SHORT = {'n_children': 3, 'n_working_age': 2, 'n_elderly': 1, 'land_total_area': 4000, 'land_any_irrigated': 0, 'crop_diversity': 3, 'crop_any_damage': 1, 'harvest_any_shortfall': 0, 'livestock_cattle': 2, 'livestock_small_ruminants': 5, 'livestock_poultry': 6, 'econ_has_nonfarm_business': 0, 'econ_psnp': 1, 'econ_total_assets': 5}


def answers(service):
    area=service.areas()[0]
    return {'area_id':area['id'],'w4_region':area['region'],**SHORT}


def test_legacy_response_and_schema_remain_unchanged(service):
    row={'w4_region':7,'hh_size':5,'cons_quintile':2,'prior_fi_any':1,'prior_fi_score':2,'diet_n_groups':3}
    # n_predictive_supplied now counts only answers about the household (region excluded).
    same=lambda r:{k:v for k,v in r.items() if k!='n_predictive_supplied'}
    assert same(service.predict(row))==same(service.bundle.predict(row))
    assert service.predict({})==service.bundle.predict({})
    assert service._schema==service.bundle.schema


def test_graph_response_has_exact_legacy_keys(service):
    row=answers(service)
    result=service.predict(row)
    assert set(result)==set(service.bundle.predict({}))
    assert result['model_version']['model']=='gcn_plus_ensemble'
    assert result['threshold']==service.graph.threshold
    assert 1<=len(result['top_factors'])<=6
    assert result['sufficient_data'] and 0<=result['probability']<=1
    assert service.predict({'area_id':row['area_id']})['probability'] is None


def test_unknown_area_and_mismatched_region_are_rejected(service):
    with pytest.raises(InvalidHousehold): service.predict({**answers(service),'area_id':'unknown'})
    with pytest.raises(InvalidHousehold): service.predict({**answers(service),'w4_region':999})
    with pytest.raises(InvalidHousehold): service.predict([])


def test_batch_keeps_area_and_matches_single_and_is_order_independent(service):
    a=answers(service);b={**a,'hh_size':8}
    first=service.predict(a)
    result=service.predict_batch(pd.DataFrame([{**a,'name':'one'},{**b,'name':'two'}]))
    assert result.loc[result.name=='one','probability'].iloc[0]==first['probability']
    assert service.predict(a)==first
    assert 'area_id' in result


def test_numpy_batch_matches_individual_and_context_is_small(service):
    a=answers(service); a.pop('area_id')
    x=pd.DataFrame([a,{**a,'hh_size':8}])
    batched=service.graph.scores(x,np.array([0,0]))
    individual=[service.graph.scores(x.iloc[[i]],np.array([0]))[0] for i in range(2)]
    np.testing.assert_allclose(batched,individual,atol=1e-6)
    assert all(len(m['layers'][0]['context'])==len(service.areas()) for m in service.graph.members)

# Explanation semantics (prediction sensitivity) are tested in test_review_fixes.py.

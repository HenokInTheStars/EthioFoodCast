"""Frozen GCNPlus inference using NumPy; no survey rows or PyTorch at serving time."""
from dataclasses import dataclass
import numpy as np
import pandas as pd
from scipy.special import expit
from .bundle import band_of
from ..contracts.validation import InvalidHousehold, validate


@dataclass
class GraphServingModel:
    features: list
    static_columns: list
    static_prep: object
    sequence_imputer: object
    sequence_scaler: object
    sequence_columns: list
    members: list
    areas: list
    threshold: float
    performance: dict
    metadata: dict
    schema: list

    def transform(self, frame):
        frame=frame.reindex(columns=self.features).apply(pd.to_numeric,errors='coerce').astype(float)
        static=self.static_prep.transform(frame[self.static_columns])
        seq=frame[self.sequence_columns].to_numpy().reshape(-1,2)
        seq=self.sequence_scaler.transform(self.sequence_imputer.transform(seq)).reshape(len(frame),4)
        return np.column_stack([seq,static]).astype(np.float32)

    def scores(self, frame, area_indices, typical_area=False):
        """Ensemble probability. typical_area swaps each area's neighbourhood context for the mean over areas."""
        x=self.transform(frame)
        scores=[]
        for member in self.members:
            h=x
            for layer in member['layers']:
                context=(np.broadcast_to(layer['context'].mean(axis=0),(len(x),layer['context'].shape[1]))
                         if typical_area else layer['context'][area_indices])
                h=np.maximum(h@layer['own_weight'].T+layer['own_bias']+context,0)
            h=np.maximum(h@member['head_weight'].T+member['head_bias'],0)
            scores.append(expit((h@member['out_weight'].T+member['out_bias']).ravel()))
        return np.mean(scores,axis=0)

    def factors(self, answers, index, top_n=6, derive_fn=None):
        """Prediction sensitivity for one household, in the legacy top_factors format.

        `answers` are the person's own answers. For each one, the answer is
        withheld (treated as unknown), every summary calculated from it is
        recalculated by `derive_fn`, and the ensemble scores again; the
        contribution is the drop in probability. 'area_context' compares this
        area with the average prediction over every supported area for the same
        answers. This is one-at-a-time sensitivity, not SHAP: contributions do
        not add up to the probability, and they describe the model, not causes.
        """
        derive_fn = derive_fn or (lambda a: a)
        own = {k: v for k, v in answers.items() if k != 'area_id'}

        def frame(ans):
            return pd.DataFrame([result_answers(derive_fn(ans), self.features)]).reindex(columns=self.features)

        base_frame = frame(own)
        base = float(self.scores(base_frame, np.array([index]))[0])
        known = {f['name'] for f in self.schema}
        supplied = [c for c in own if c in known and c not in ('w4_region', 'is_agricultural')
                    and pd.notna(pd.to_numeric(own[c], errors='coerce'))]
        rows = []
        if supplied:
            probes = pd.concat([frame({k: v for k, v in own.items() if k != c}) for c in supplied], ignore_index=True)
            withheld = self.scores(probes, np.full(len(supplied), index))
            rows = [(c, c, base - float(q)) for c, q in zip(supplied, withheld)]
        # The same answers placed in every supported area, each with its own region.
        everywhere = pd.concat([base_frame] * len(self.areas), ignore_index=True)
        everywhere['w4_region'] = [a['region'] for a in self.areas]
        average = float(self.scores(everywhere, np.arange(len(self.areas))).mean())
        rows.append(('area_context', 'Surveyed-area context', base - average))
        rows.sort(key=lambda r: abs(r[2]), reverse=True)
        return [{'feature': label, 'source_field': source, 'encoded_name': source, 'contribution': round(value, 4),
                 'direction': 'increases risk' if value > 0 else 'reduces risk'} for source, label, value in rows[:top_n]]

    def predict(self, household, fallback, original=None, derive_fn=None):
        if not isinstance(household,dict):
            raise InvalidHousehold('expected a dict of field -> value')
        raw=household.get('area_id')
        if raw is None or raw is pd.NA or (isinstance(raw,(float,np.floating)) and np.isnan(raw)) or (isinstance(raw,str) and not raw.strip()):
            return fallback.predict({k:v for k,v in household.items() if k!='area_id'})
        ids={a['id']:i for i,a in enumerate(self.areas)}
        if not isinstance(raw,str) or raw not in ids:
            raise InvalidHousehold('area_id: select a supported area from Service.areas()')
        index=ids[raw]
        answers={k:v for k,v in household.items() if k!='area_id'}
        region=answers.get('w4_region')
        validate(answers,self.schema)
        if region is not None and pd.notna(region) and float(region)!=self.areas[index]['region']:
            raise InvalidHousehold('area_id and w4_region refer to different regions')
        answers['w4_region']=self.areas[index]['region']
        # Location data (rainfall, distances, soil, agro-ecology...) the form left unknown are
        # filled from the survey area's training households (model v2 carries area_defaults).
        defaults=(getattr(self,'area_defaults',None) or [{}]*len(self.areas))[index]
        filled=[k for k,v in defaults.items() if pd.isna(pd.to_numeric(answers.get(k),errors='coerce'))]
        answers.update({k:defaults[k] for k in filled})
        def fill(a):
            a=dict(derive_fn(a) if derive_fn else a)
            a.update({k:v for k,v in defaults.items() if pd.isna(pd.to_numeric(a.get(k),errors='coerce'))})
            return a
        import copy
        routed=copy.copy(fallback)
        routed.schema=self.schema
        routed.features=self.features
        routed.pipeline=AreaPipeline(self,index)
        routed.threshold=self.threshold
        routed.metadata=self.metadata
        routed.explainer=None
        result=routed.predict(answers)
        if result['probability'] is not None:
            own=dict(original if original is not None else answers)
            own['w4_region']=self.areas[index]['region']
            result['top_factors']=self.factors(own,index,derive_fn=fill)
        if filled:
            result['warnings'].append(f'{len(filled)} location value(s) (satellite rainfall and vegetation, or other area data) '
                                      'were filled from the survey area.')
        form = self.metadata.get('form')
        result['warnings'] += [
            'Graph forecast uses historical neighbours in the selected surveyed area; '
            + (f"the model was trained and evaluated on this {self.metadata.get('n_answers')}-question form." if form
               else 'evaluation used full survey features.'),
            'Factors show prediction sensitivity: how much the estimate changes when one answer is left unknown. They are not SHAP values and do not add up to the estimate.'
        ]
        return result


def result_answers(answers, features):
    """Numeric model inputs only; blanks stay missing, matching how predict() scored them."""
    return {c:pd.to_numeric(answers.get(c),errors='coerce') for c in features}


class AreaPipeline:
    def __init__(self,model,index):
        self.model,self.index=model,index
    def predict_proba(self,frame):
        p=self.model.scores(frame,np.full(len(frame),self.index,dtype=int))
        return np.column_stack([1-p,p])

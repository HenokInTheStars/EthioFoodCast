# Graph backend (GCN ensemble) — frontend contract preserved

Existing Service methods, input_schema(), defaults(), prediction response keys,
batch output columns and no-area requests keep their behaviour. The legacy
dashboard method names still work but now return the deployed GCN's data (see
below). The original ExtraTrees bundle remains the compatibility fallback.

The graph model needs a specific supported survey area. Region alone is not
enough.

```python
areas = svc.areas()                  # [{id, label, region}, ...]
form = svc.graph_input_schema()     # same field-record format as input_schema()
metrics = svc.graph_performance()   # graph-specific historical evaluation

# Streamlit example; keep the opaque ID as the submitted value.
by_id = {a['id']: a for a in areas}
area_id = st.selectbox('Surveyed area', list(by_id),
    format_func=lambda key: f"{by_id[key]['label']} (region {by_id[key]['region']})")
result = svc.predict({**household_answers, 'area_id': area_id})
```

The return shape is unchanged: probability, risk_band, flagged, threshold,
model_version, warnings, top_factors, cluster, recommendations and the existing
sufficiency/count/caveat fields. Batch input can also include area_id.

- No area_id: unchanged ExtraTrees prediction and threshold.
- Valid area_id: GCNPlus ensemble and its saved threshold (0.521176).
- Unknown area or conflicting region: InvalidHousehold, as for other bad inputs.
- Too few answers: probability remains None. The graph model needs at least 9 of
  its 14 questions (`svc.graph.metadata["min_answers"]`); region and calculated
  summaries do not count.
- Answers that are real survey questions but not inputs of this model (for example
  diet or food-history answers) are set aside with a warning, not rejected; they
  still set the vulnerability segment and support prompts. Misspelt field names
  are rejected.
- **top_factors for graph predictions are GCN occlusion effects** (same keys as
  before: feature, source_field, encoded_name, contribution, direction). Each
  is the change in the ensemble probability when that answer is withheld and
  imputed as missing. The special factor `source_field == "area_context"`
  ("Surveyed-area context") is the change when the area's neighbourhood is
  replaced by the average area. They describe model behaviour, not causes, and
  are not additive like SHAP; a warning in the response says so.
- **The model is form-specific.** It was trained and evaluated only on the
  14-question agricultural form, so its accuracy is the accuracy of that form:
  household (children, working-age, elderly), land and crops (area in m²,
  irrigation, crops grown, crop damage, harvest shortfall), livestock owned 12
  months ago (cattle, sheep and goats, chickens) and livelihood (non-farm
  business, PSNP, household items). `svc.graph.metadata["answers"]` lists them.
- Area labels name the zone and approximate woreda (`svc.areas()` gives
  `survey_label`, `zone`, `woreda` and whether each was verified). No
  coordinates or household IDs are exported.

## Forms ask questions; the backend calculates summaries

Some model inputs are summaries nobody can answer directly: household size,
dependants per working adult, livestock units (TLU) and land and livestock per
person. `predict()` calculates them from the underlying questions
(`serving/derive.py`); a value supplied explicitly is kept, and a summary stays
missing unless all of its questions are answered.

TLU from the three asked herd counts uses fixed weights (cattle 0.6 as a herd
average, sheep/goat 0.1, chicken 0.01). Training used 16 animal types, so this is
an approximation; given only the 14 answers, the app's accuracy on the held-out
households is 79.55% against 79.34% with the exact training inputs (99.4% of
decisions identical).

```python
form = svc.graph_form(short=True)     # grouped, answerable questions only
svc.derived_fields()                  # summary -> the questions it is computed from
svc.field_labels(), svc.field_help()  # plain labels and hover text for every field
```

Build forms from `graph_form()` rather than `graph_input_schema()`, which
still lists every model input including the summaries.


## Graph dashboard methods (new, additive)

Built from the seed-0 **held-out** agricultural households (484) scored by the
deployed GCN, so every figure is out-of-sample for this model. Files live in
`backend/artifacts/ui_graph/` and contain aggregates and an anonymised list only.

| Method | Use it for |
|---|---|
| `graph_comparison()` | Four model families under one protocol (GCN, ExtraTrees, LightGBM, logistic regression) |
| `graph_regional_summary()` | Map page: per-region mean risk, observed rate, flagged/high share; cells < 25 suppressed |
| `graph_risk_distribution()` | Overview: band counts, histogram, risk by segment |
| `graph_drivers()` | GCN occlusion drivers by field and by domain |
| `graph_dashboard_performance()` | Held-out confusion matrix and metrics, training summary |
| `graph_scored_households()` | Intervention planning list (surrogate id, region, area label, risk, segment, factors, categories) |
| `cluster_profiles()` | Segment profiles (raw means and z-scores) |
| `regions()`, `field_labels()` | Region names for `w4_region`; readable labels for every field |

The legacy dashboard method names (`performance()`, `global_drivers()`,
`scored_households()`, `regional_summary()`, `risk_distribution()`) are kept for
compatibility. They return the same deployed GCN data as the `graph_*` methods
above (held-out households), not the ExtraTrees model's figures.

## Optional HTTP API

`backend/api_server.py` wraps the same Service in FastAPI for non-Python frontends
(the web demo uses it). Streamlit apps do not need it.

```
backend\start_api.bat                                             # from the repository root
http://localhost:5000/docs                                          # interactive docs
```

Endpoints: `/api/meta`, `/api/schema`, `/api/areas`, `POST /api/predict`,
`POST /api/predict_batch`, `/api/overview`, `/api/regional`, `/api/drivers`,
`/api/comparison`, `/api/performance`, `/api/segments`, `/api/planning`, and the
figures under `/figures/...`. Invalid households return 422 with the reason.

## Evidence

The saved seed-0 ensemble was reproduced exactly before export: 79.34% accuracy,
80.20% recall, 84.84% precision, F1 0.825, AP 0.911 and ROC-AUC 0.874 on 484
historical held-out agricultural households. Over the five splits: mean accuracy
78.44% (75.98-81.03%), recall 84.37%, ROC-AUC 0.856. The seed-0
configuration was retained for traceability, not selected because it was the
best-performing seed. Neighbours are the original training reference cohort;
no test labels enter fitting, and queries never update that reference.
These reused historical splits are not a new external test or a guarantee for
current-year forecasts. Predefined risk bands are descriptive, not calibrated
assistance categories.

Figures (PNG):
- backend/reports/figures/graph_model/model_comparison_4: four model families, means and all five splits.
- backend/reports/figures/graph_model/holdout_diagnostics: confusion matrix, ROC, PR and calibration.
- backend/reports/figures/graph_model/serving_flow: data and model flow.
- backend/reports/figures/01–08, 12–13: exploratory analysis and segmentation.

The graph artifact contains fitted preprocessing, network weights and frozen
per-area/per-layer context. It contains no raw household rows or outcome arrays.
Inference uses NumPy/SciPy, so serving requirements do not add PyTorch.

After replacing backend files/artifacts, restart Streamlit or clear its cached
Service once so the new graph artifact is loaded.

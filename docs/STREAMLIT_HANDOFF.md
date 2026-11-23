# Handover: building the frontend

You build the UI. Everything below it (the graph model, the calculated inputs,
validation, segmentation, explanations and the support rules) is done and is
reached through **one object**, `Service`. A Python/Streamlit app imports it
directly; any other frontend uses the same object over HTTP (`api_server.py`,
see `GRAPH_BACKEND_HANDOFF.md`).

---

## Five-minute start

Needs Python 3.11. From the repository root, `backend\start_api.bat` creates
`.venv` and installs `backend\requirements.txt` on the first run (a few minutes,
internet needed).

```bat
backend\start_api.bat                                :: API on http://localhost:5000 (docs at /docs)
.venv\Scripts\python.exe -m pytest backend\tests -q  :: expect 90 passed, 1 skipped
```

**Windows: extract somewhere short.** `C:\dev\EthioFoodCast` is fine; a deep path
under `Downloads\...\...` can make pip fail while installing numpy unless
long-path support is enabled.

**Install the pinned versions.** The model files are pickles of fitted
scikit-learn objects, so `scikit-learn==1.6.1` is exact. A newer version fails to
load them; `IncompatibleEnvironment` is raised with the fix in the message.

```python
# your_app.py
import streamlit as st
from backend import Service, ArtifactsMissing, InvalidHousehold

@st.cache_resource          # load the model once per server, not per click
def service():
    return Service()

svc = service()
area = svc.areas()[0]
result = svc.predict({"area_id": area["id"],
    "n_children": 3, "n_working_age": 2, "n_elderly": 1,
    "land_total_area": 4000, "land_any_irrigated": 0, "crop_diversity": 3,
    "crop_any_damage": 1, "harvest_any_shortfall": 0,
    "livestock_cattle": 2, "livestock_small_ruminants": 5, "livestock_poultry": 6,
    "econ_has_nonfarm_business": 0, "econ_psnp": 1, "econ_total_assets": 5})
st.write(result["probability"], result["risk_band"])
```

`backend/backend.py` is the only import facade you need. It puts `backend/src/` on
the path for you.

---

## The model in one paragraph

A graph neural network (GCN ensemble of 5) forecasts whether an agricultural
household is food insecure in 2021/22 from its 2018/19 situation. It was trained
and validated on a **14-question agricultural form**: household (children,
working-age, elderly), land and crops (farmland in m², irrigation, crops grown,
crop damage, harvest shortfall), livestock owned 12 months ago (cattle, sheep and
goats, chickens) and livelihood (non-farm business, PSNP, household items). The
survey area adds its neighbours and its 2018/2019 rainfall and vegetation.
Held-out accuracy: 78.4% over five splits (every split at or above 76.0%), 84.4%
of food-insecure households caught, ROC-AUC 0.856.

---

## The one call you will use most

```python
result = svc.predict(household_dict)   # must include "area_id" from svc.areas()
```

```python
{
  "probability": 0.9119,            # None when too few questions are answered
  "risk_band": "High",              # or "Insufficient data"
  "flagged": True,                  # the operating decision at the threshold
  "threshold": 0.5212,
  "band_meaning": "descriptive label for the probability",
  "flag_meaning": "selected for assessment at threshold 0.521; ...",
  "sufficient_data": True,
  "n_predictive_supplied": 14,      # form questions answered
  "warnings": [...],
  "top_factors": [ {feature, source_field, encoded_name, contribution, direction}, ... ],
  "cluster": {"id": 0, "name": "Typical smallholder"},
  "recommendations": [ {category, prompt, triggered_by, value}, ... ],
  "model_version": {...},
  "caveats": [ limitation strings ],
}
```

### Three things this response needs you to respect

**`probability` can be `None`.** At least **9 of the 14** questions must be
answered (`svc.graph.metadata["min_answers"]`). Region and calculated summaries
do not count. Show "Insufficient information" and the `warnings` instead.

```python
if result["probability"] is None:
    st.warning("Insufficient information")
    for w in result["warnings"]:
        st.caption(w)
    st.stop()
```

**`risk_band` and `flagged` are different things.** The band describes the
probability; the flag is the operating decision at the threshold. Show both, and
use `band_meaning` / `flag_meaning` as the tooltip text.

**`caveats` belongs on screen, next to the number.** About 40% of the model's
sensitivity comes from the survey area, and it cannot establish causation.

---

## Building the form

```python
form = svc.graph_form(short=True)     # the 14 questions, grouped in interview order
more = svc.graph_form(short=False)    # plus optional questions (segment and prompts only)
labels, help_text = svc.field_labels(), svc.field_help()   # plain label and hover text per field
areas = svc.areas()                   # id, region, zone, woreda, readable label
```

Each field gives you `name`, `group`, `dtype`, `min`, `max`, `median_default`,
`allowed_values`, `required` and `used_for`. Build widgets from it rather than
hardcoding; the schema comes from the trained model.

| Field kind | Control | Why |
|---|---|---|
| `allowed_values` present | dropdown of those values | A slider can produce region 2.5, which is rejected |
| `dtype == "binary"` | three-state: Unknown / No / Yes | An unticked box is not a "No" |
| Whole-number counts | integer input | A household cannot have 6.4 members |
| Everything else | number input | |

**Start every field at "Unknown"** and only send fields the user answered.
Never ask for calculated values (household size, dependency ratio, livestock
units, per-person values): the backend calculates them (`svc.derived_fields()`).

`used_for == "cluster"` or `"rule"` marks optional fields that only set the
segment and support prompts; they never change the risk estimate.

### `top_factors` naming

`feature` is display text. `source_field` is the schema field name, so you can
join back to `field_labels()`. `area_context` is the survey area's effect
compared with the average area. Factors are prediction sensitivities (the change
when an answer is unknown), not SHAP values, and they do not add up.

---

## The other calls

```python
svc.predict_batch(dataframe)         # CSV upload (include area_id); sorted by risk
svc.capacity_plan(scored, 500)       # "we can visit 500 — who?"

svc.risk_distribution()              # overview page
svc.regional_summary()               # map page; cells under 25 households suppressed
svc.global_drivers()                 # share of sensitivity by section
svc.clusters(), svc.cluster_profiles()   # segment page
svc.performance()                    # model page: held-out metrics + five-split summary
svc.graph_intake_evaluation()        # form comparison and missing-answer results
svc.graph_comparison()               # four model families under one protocol
svc.scored_households()              # anonymised held-out planning list
svc.caveats(), svc.risk_bands(), svc.graph_version()
```

### `predict_batch`

Unrecognised columns (identifiers, notes) pass through untouched and are never
scored. Rows with too little information come back with `probability = NaN`
rather than failing the upload.

### `capacity_plan`

Sorts internally. Returns `selected`, `unscored`, `note` and `precision_note`.
Check `n_rankable` before drawing a capacity widget. `historical_precision_at_25pct`
is a past measurement at one coverage level, **not** a forecast for the current
list; display `precision_note` with it.

---

## Errors you must handle

```python
from backend import (Service, ArtifactsMissing, IncompatibleEnvironment, InvalidHousehold)
```

| Exception | When | What to do |
|---|---|---|
| `ArtifactsMissing` | Model files missing | Show the message |
| `IncompatibleEnvironment` | Installed scikit-learn cannot read the model files | An install problem; show the message, which names the fix |
| `InvalidHousehold` | Unknown survey area, misspelt field name, wrong type, impossible value | Show the message; it names the field and the problem |

The first two happen at `Service()` construction. Blank values (`None`, `NaN`,
`pd.NA`) are **not** errors; they mean "not answered".

---

## Suggested pages

| Page | Calls |
|---|---|
| Overview | `risk_distribution`, `regional_summary`, `global_drivers`, `performance` |
| Household assessment | `areas`, `graph_form`, `field_labels`, `field_help`, `predict` |
| Batch scoring | `predict_batch`, `capacity_plan` |
| Vulnerability segments | `clusters`, `cluster_profiles` |
| Model and methodology | `performance`, `graph_intake_evaluation`, `graph_comparison`, `caveats` |

---

## Two things to tell users, in the UI

**The baseline is high.** 61% of held-out agricultural households were food
insecure, so always predicting "insecure" would score 61%. Show accuracy (78.4%)
together with recall (84.4%) and precision in the top quarter (94%).

**The ordered list is the product.** The estimate ranks households for a human
follow-up assessment; it is not an eligibility decision.

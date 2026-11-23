"""Optional HTTP API over the same Service a Streamlit app imports.

Streamlit developers do not need this file: they import `backend.Service`
directly. It exists for non-Python frontends such as the web demo. Every
endpoint is a thin call into Service -- no scoring logic lives here.

Run:  backend/start_api.bat from the repository root
Docs: http://localhost:5000/docs
"""
import math
from pathlib import Path

import pandas as pd
from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend import ArtifactsMissing, InvalidHousehold, Service

svc = Service()
app = FastAPI(title="EthioFoodCast API", version="1.0",
              description="Household food-insecurity forecasting (GCN ensemble) for decision support.")
# Local demo: any origin. Restrict this list before deploying anywhere shared.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.mount(
    "/figures",
    StaticFiles(directory=Path(__file__).resolve().parent / "reports" / "figures"),
    name="figures",
)


def clean(value):
    """JSON-safe: NaN/inf -> None, DataFrames -> records, numpy scalars -> Python."""
    if isinstance(value, pd.DataFrame):
        return clean(value.to_dict("records"))
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    if hasattr(value, "item") and not isinstance(value, (str, bytes)):
        value = value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


@app.get("/api/health")
def health():
    return {"status": "ok", "model": svc.graph.metadata.get("model") if svc.graph else "extra_trees"}


@app.get("/api/meta")
def meta():
    return clean({"version": svc.graph_version(), "caveats": svc.caveats(), "risk_bands": svc.risk_bands(),
                  "regions": svc.regions(), "field_labels": svc.field_labels(), "field_help": svc.field_help(), "derived_fields": svc.derived_fields(),
                  "threshold": svc.graph.threshold if svc.graph else None,
                  "min_answers": int(svc.graph.metadata.get("min_answers", 5)) if svc.graph else 5})


@app.get("/api/schema")
def schema(full: bool = False):
    """Answerable form fields, grouped (computed summaries excluded). full=false is the short form."""
    return clean(svc.graph_form(short=not full))


@app.get("/api/areas")
def areas(region: int | None = None):
    return [a for a in svc.areas() if region is None or a["region"] == region]


@app.post("/api/predict")
def predict(household: dict = Body(...)):
    # The web workflow is the graph model: never fall back to ExtraTrees silently.
    if not household.get("area_id"):
        raise HTTPException(status_code=422, detail="Survey area: select the household's survey area; the GCN model needs it")
    try:
        return clean(svc.predict(household))
    except InvalidHousehold as error:
        raise HTTPException(status_code=422, detail=str(error))


@app.post("/api/predict_batch")
def predict_batch(rows: list[dict] = Body(...)):
    try:
        return clean(svc.predict_batch(pd.DataFrame(rows)))
    except InvalidHousehold as error:
        raise HTTPException(status_code=422, detail=str(error))


@app.get("/api/overview")
def overview():
    return clean({"risk_distribution": svc.graph_risk_distribution(), "regional": svc.graph_regional_summary(),
                  "drivers": svc.graph_drivers(), "comparison": svc.graph_comparison(),
                  "performance": svc.graph_dashboard_performance()})


@app.get("/api/regional")
def regional():
    return clean(svc.graph_regional_summary())


@app.get("/api/drivers")
def drivers():
    return clean(svc.graph_drivers())


@app.get("/api/comparison")
def comparison():
    return clean(svc.graph_comparison())


@app.get("/api/performance")
def performance():
    return clean({**svc.graph_dashboard_performance(), "graph": svc.graph_performance(),
                  "intake": svc.graph_intake_evaluation()})


@app.get("/api/segments")
def segments():
    return clean({"clusters": svc.clusters(), "profiles": svc.cluster_profiles(),
                  "risk_by_cluster": svc.graph_risk_distribution().get("by_cluster", [])})


@app.get("/api/planning")
def planning(region: int | None = None, band: str | None = None, cluster: str | None = None,
             flagged_only: bool = False, capacity: int = Query(50, ge=0, le=5000)):
    """Filter the anonymised held-out list and select the top `capacity` households by risk."""
    frame = svc.graph_scored_households()
    if region is not None:
        frame = frame[frame.region_code == region]
    if band:
        frame = frame[frame.risk_band == band]
    if cluster:
        frame = frame[frame.cluster == cluster]
    if flagged_only:
        frame = frame[frame.flagged]
    frame = frame.sort_values("probability", ascending=False)
    categories = frame.support_categories.explode().value_counts()
    return clean({"n_matching": len(frame), "selected": frame.head(capacity),
                  "support_category_counts": categories.to_dict()})


@app.exception_handler(ArtifactsMissing)
def missing(_, error):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=503, content={"detail": str(error)})

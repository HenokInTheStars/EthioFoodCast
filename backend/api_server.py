"""Optional HTTP API over the same Service a Streamlit app imports.

Streamlit developers do not need this file: they import `backend.Service`
directly. It exists for non-Python frontends such as the web demo. Every
endpoint is a thin call into Service -- no scoring logic lives here.

Run:  backend/start_api.bat from the repository root
Docs: http://localhost:5000/docs
"""
import math
import os
import time
from collections import defaultdict, deque
from pathlib import Path

import pandas as pd
from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend import ArtifactsMissing, InvalidHousehold, Service

svc = Service()
app = FastAPI(title="EthioFoodCast API", version="1.0",
              description="Household food-insecurity forecasting (GCN ensemble) for decision support.")

# ---- deployment settings (environment variables) ---------------------------
# ALLOWED_ORIGINS     comma-separated websites allowed to call the API from a
#                     browser, e.g. "https://ethiofoodcast.vercel.app". "*" allows any.
# RATE_LIMIT_PREDICT  scorings per minute per client (0 disables). Default 60.
# RATE_LIMIT_BATCH    batch uploads per minute per client (0 disables). Default 10.
# MAX_BATCH_ROWS      rows accepted in one batch upload. Default 2000.
LOCAL_ORIGINS = ["http://localhost:3001", "http://127.0.0.1:3001", "http://localhost:3000"]


def allowed_origins() -> list[str]:
    configured = [origin.strip().rstrip("/") for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")]
    configured = [origin for origin in configured if origin]
    return configured or LOCAL_ORIGINS


RATE_LIMITS = {
    "/api/predict": int(os.getenv("RATE_LIMIT_PREDICT", "60")),
    "/api/predict_batch": int(os.getenv("RATE_LIMIT_BATCH", "10")),
}
MAX_BATCH_ROWS = int(os.getenv("MAX_BATCH_ROWS", "2000"))
_recent_requests: dict[tuple[str, str], deque] = defaultdict(deque)


def client_address(request: Request) -> str:
    # Hosting platforms put the visitor's address first in X-Forwarded-For.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    """A per-client sliding one-minute window on the two scoring endpoints.

    In memory and per process: enough to stop a public demo being hammered, not
    a substitute for a gateway in a real deployment.
    """
    limit = RATE_LIMITS.get(request.url.path, 0) if request.method == "POST" else 0
    if limit > 0:
        now = time.monotonic()
        recent = _recent_requests[(request.url.path, client_address(request))]
        while recent and recent[0] <= now - 60:
            recent.popleft()
        if len(recent) >= limit:
            return JSONResponse(status_code=429, headers={"Retry-After": "60"},
                                content={"detail": "Too many requests. Wait a minute and try again."})
        recent.append(now)
        if len(_recent_requests) > 10_000:  # forget idle clients
            for key in [key for key, hits in _recent_requests.items() if not hits]:
                del _recent_requests[key]
    return await call_next(request)


# Added after the rate limiter so it wraps it: a 429 still carries CORS headers
# and the browser can read the message instead of reporting a network error.
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins(), allow_methods=["GET", "POST"],
                   allow_headers=["Content-Type"])
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
    if len(rows) > MAX_BATCH_ROWS:
        raise HTTPException(status_code=413, detail=f"Too many rows: send at most {MAX_BATCH_ROWS} households at a time.")
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

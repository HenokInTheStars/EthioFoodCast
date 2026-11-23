# EthioFoodCast

Forecasts whether an Ethiopian agricultural household will be food insecure in
2021/22 from its 2018/19 situation: the household, its land and crops, its
livestock and its livelihood, plus its survey area's rainfall and vegetation. The
model is a graph neural network (GCN ensemble) that combines each household with
its survey area and nearby areas. It also returns explanations, a vulnerability
segment and rule-based follow-up categories.

The intake form has 14 questions (at least 9 must be answered); household size,
dependency ratio, livestock units and per-person values are calculated.

## Team

| Name | Role |
|---|---|
| Henok Solomon | Data and frontend |
| Niyat Debesay | Machine learning and backend |
| Amina Aman | Product and analytics |

## Run

Needs Python 3.11 or 3.12 (the Docker image uses 3.11). The first run creates the repository-root `.venv` and installs
`backend\requirements.txt` (a few minutes, internet needed); later runs start at once:

```bat
backend\start_api.bat                                :: API on http://localhost:5000
.venv\Scripts\python.exe -m pytest backend\tests -q  :: expect 90 passed, 1 skipped
```

By hand:

```bat
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.venv\Scripts\python.exe -m uvicorn backend.api_server:app --port 5000
```

API docs: http://localhost:5000/docs

## Run in Docker

Needs Docker with the Compose plugin. The API image is self-contained (the model
artifacts are copied in, ~53 MB of pickles):

```bat
docker compose up --build                       :: API on http://localhost:5000
docker compose run --rm api python -m pytest tests -q
docker compose --profile demo up --build        :: adds the Next.js demo on :3001
docker compose logs -f api
docker compose down -v
```

Both services publish to `127.0.0.1` only: there is no authentication in this
project, so the stack must not answer on the LAN.

If port 5000 or 3001 is already taken by something else on the machine, override
the host ports. `NEXT_PUBLIC_API_URL` is baked into the browser bundle at build
time, so it has to move with `API_PORT` — change it in the same command:

```bat
set API_PORT=5010
set WEB_PORT=3010
set NEXT_PUBLIC_API_URL=http://localhost:5010
docker compose --profile demo up --build
```

`frontend/` also builds on its own:

```bat
npm --prefix frontend install
npm --prefix frontend run build   :: regenerates frontend/data from backend/artifacts, then builds
npm --prefix frontend run dev     :: http://localhost:3001, needs the API running
```

## Deploy

The API runs on Hugging Face Spaces and the website on Vercel, both on free plans.
`docs/DEPLOYMENT.md` has the step-by-step guide; the API is published with
`scripts/publish_hf_space.sh <user>/<space>`. Set `ALLOWED_ORIGINS` on the API to the
website's address. Scoring is rate-limited per visitor (settings in the guide).

## Use from Python (Streamlit)

Streamlit is not part of the server requirements; install it with
`pip install "streamlit>=1.40,<2"` if you build a Streamlit app.

```python
from backend import Service
svc = Service()
area = svc.areas()[0]
result = svc.predict({"area_id": area["id"],
    "n_children": 3, "n_working_age": 2, "n_elderly": 1,                       # household
    "land_total_area": 4000, "land_any_irrigated": 0, "crop_diversity": 3,     # land and crops (m², count)
    "crop_any_damage": 1, "harvest_any_shortfall": 0,
    "livestock_cattle": 2, "livestock_small_ruminants": 5, "livestock_poultry": 6,
    "econ_has_nonfarm_business": 0, "econ_psnp": 1, "econ_total_assets": 5})   # livelihood
form = svc.graph_form(short=True)    # the 14 questions, grouped, with labels via svc.field_labels()
```

Read `docs/STREAMLIT_HANDOFF.md` (how to build the frontend: form, response,
errors, pages) and then `docs/GRAPH_BACKEND_HANDOFF.md` (the GCN model,
explanations, graph dashboard methods and HTTP API).

## What is here

| Path | Contents |
|---|---|
| `backend/__init__.py`, `backend/backend.py` | Python service import facade (`from backend import Service`) |
| `backend/api_server.py` | FastAPI wrapper over the same Service |
| `backend/start_api.bat` | Starts the API; creates the root `.venv` if missing |
| `backend/src/ethiofoodcast/serving/` | Graph model inference, calculated inputs, the Service |
| `backend/src/ethiofoodcast/contracts/`, `rules/`, `export/` | Validation, support rules, privacy |
| `backend/src/ethiofoodcast/features/`, `data/`, `cleaning/`, `target/` | How the survey data and label were built |
| `backend/src/ethiofoodcast/eda/`, `explain/`, `evaluation/`, `models/` | EDA figures, explanations, metrics, preprocessing and segments |
| `backend/artifacts/graph_serving.joblib` | GCN ensemble, 14-question agricultural form (NumPy inference, no raw data) |
| `backend/artifacts/model_bundle.joblib` | Segment model and the fallback used when no survey area is given |
| `backend/artifacts/ui_graph/` | Dashboard data (held-out, aggregated, anonymised), labels, help texts, area names |
| `backend/artifacts/ui/clusters.json` | Segment summary |
| `frontend/` | Next.js workspace: interview form, dashboards, and offline keyword search over bundled project evidence |
| `backend/reports/figures/` | EDA, segmentation and model figures |
| `backend/reports/graph_serving/verification.json` | Export verification record |
| `backend/tests/` | Contract, serving, validation and API tests |
| `docs/` | Frontend design and developer handoff guides |

No raw survey data, household IDs or coordinates are included.

## Knowledge centre

`/knowledge` holds plain-language articles for visitors: the data, how the score works,
accuracy and limits, responsible use, a glossary and an FAQ. The articles are Markdown files in
`frontend/content/knowledge/` (`NN-slug.md`, with `title` and `summary` front matter). Figures
are written as `{{placeholders}}` that `npm run data` fills from the model's result files, so the
text always matches the dashboards; an unknown placeholder or a broken `/knowledge` link fails
the build.

Typing in the question box searches the articles in the browser, offline. **Ask** sends only
the question to `/api/knowledge/ask`, which picks the matching sections on the server and asks
Groq to answer from them alone. Every answer cites its sections, and an answer without valid
citations is rejected. Visitors' offline library files are never sent. The route needs
`GROQ_API_KEY` and `GROQ_MODEL` in the server environment (for local development, in
`frontend/.env.local`, never with a `NEXT_PUBLIC_` prefix); without them, search still works and
the Ask button is hidden. Questions are limited to 6 a minute per visitor and 60 a minute in
total (`ASK_RATE_LIMIT`, `ASK_GLOBAL_RATE_LIMIT`).

The page also links recent publications from official sources (titles, dates and links only)
and offers a browser-local library for the visitor's own PDF, TXT and Markdown files, stored in
IndexedDB and never uploaded.

To refresh official-source metadata while online, run:

```bat
.venv\Scripts\python.exe scripts\sync_official_sources.py
npm --prefix frontend run data
```

The metadata sync is currently manual; schedule it only in an environment with outbound access
and after reviewing the configured source registry. In a production PWA, open `/knowledge` online
once to cache its route and assets for offline use; the development server does not enable offline
caching.

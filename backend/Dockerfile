# syntax=docker/dockerfile:1
#
# EthioFoodCast serving API -- the FastAPI wrapper (api_server.py) over the GCN
# ensemble. Build from the repository root.
#
#   docker build -f backend/Dockerfile -t ethiofoodcast-api .
#   docker run --rm -p 127.0.0.1:5000:5000 ethiofoodcast-api
#   curl http://localhost:5000/api/health
#   docker compose run --rm api python -m pytest tests -q
#
# Python 3.11, not "latest". requirements.txt pins scikit-learn==1.6.1 because
# artifacts/*.joblib are pickles of fitted sklearn objects: a different minor
# version does not fail the build, it fails at import with an AttributeError
# deep inside pickle. Keep this base tag and that pin together.

FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/app/src \
    MPLCONFIGDIR=/tmp/ethiofoodcast-mpl

WORKDIR /app

RUN useradd --create-home --shell /usr/sbin/nologin app

# Dependencies before source: this layer is cached until requirements.txt moves,
# so editing a .py file does not reinstall scikit-learn and shap.
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --default-timeout=120 --retries=10 -r requirements.txt

# Keep the package, artifacts and reports together in /app: backend.py puts
# ./src on sys.path, and config/paths.py resolves paths relative to that root.
#
#   backend/*.py     -> the importable surface + HTTP layer
#   backend/src/     -> ethiofoodcast package
#   backend/artifacts and backend/reports -> models, UI data and figures
#   backend/tests/   -> so the image can self-check in CI
COPY backend/backend.py backend/api_server.py ./
COPY backend/src/ ./src/
COPY backend/artifacts/ ./artifacts/
COPY backend/reports/ ./reports/
COPY backend/tests/ ./tests/
COPY scripts/ ./scripts/

RUN chown -R app:app /app
USER app

# One worker by default. Every uvicorn worker deserialises the ~53 MB graph
# bundle into its own address space, so --workers 4 costs ~212 MB of RSS and
# four cold starts before the first request. Raise it only for a host with the
# memory to hold them.
ENV UVICORN_WORKERS=1
EXPOSE 5000

# Probe with the interpreter already in the image: slim has no curl or wget, and
# installing either only to satisfy a healthcheck is ~15 MB of attack surface.
# start-period covers Service() deserialising the bundles on first boot.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD ["python", "-c", "import os, sys, urllib.request; port = os.environ.get('PORT', '5000'); sys.exit(0 if urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=5).status == 200 else 1)"]

# Hosts such as Render pass the port in $PORT; locally it is 5000.
# --proxy-headers so the rate limiter sees the visitor's address behind the host's proxy.
CMD ["sh", "-c", "exec python -m uvicorn api_server:app --host 0.0.0.0 --port ${PORT:-5000} --workers ${UVICORN_WORKERS} --proxy-headers --forwarded-allow-ips='*'"]

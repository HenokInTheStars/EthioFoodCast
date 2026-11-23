"""Settings that matter once the API is public: rate limits, batch size, CORS."""
import pytest
from fastapi.testclient import TestClient

import api_server


@pytest.fixture
def client():
    api_server._recent_requests.clear()
    yield TestClient(api_server.app)
    api_server._recent_requests.clear()


def test_scoring_is_rate_limited_per_client(client, monkeypatch):
    monkeypatch.setitem(api_server.RATE_LIMITS, "/api/predict", 2)
    headers = {"X-Forwarded-For": "203.0.113.7"}
    statuses = [client.post("/api/predict", json={}, headers=headers).status_code for _ in range(3)]
    assert statuses[:2] == [422, 422]          # under the limit: normal validation answer
    assert statuses[2] == 429                  # third request in the minute is refused
    # A different visitor is not affected by the first one's limit.
    assert client.post("/api/predict", json={}, headers={"X-Forwarded-For": "198.51.100.1"}).status_code == 422


def test_rate_limit_reply_is_readable_by_the_browser(client, monkeypatch):
    monkeypatch.setitem(api_server.RATE_LIMITS, "/api/predict", 1)
    headers = {"X-Forwarded-For": "203.0.113.8", "Origin": "http://localhost:3001"}
    client.post("/api/predict", json={}, headers=headers)
    refused = client.post("/api/predict", json={}, headers=headers)
    assert refused.status_code == 429
    assert refused.headers["access-control-allow-origin"] == "http://localhost:3001"
    assert "Too many requests" in refused.json()["detail"]


def test_reads_are_not_rate_limited(client, monkeypatch):
    monkeypatch.setitem(api_server.RATE_LIMITS, "/api/predict", 1)
    assert all(client.get("/api/health").status_code == 200 for _ in range(5))


def test_batch_size_is_capped(client, monkeypatch):
    monkeypatch.setattr(api_server, "MAX_BATCH_ROWS", 3)
    response = client.post("/api/predict_batch", json=[{}] * 4)
    assert response.status_code == 413
    assert "at most 3" in response.json()["detail"]


def test_allowed_origins_come_from_the_environment(monkeypatch):
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    assert api_server.allowed_origins() == api_server.LOCAL_ORIGINS
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://ethiofoodcast.vercel.app/, https://example.org")
    assert api_server.allowed_origins() == ["https://ethiofoodcast.vercel.app", "https://example.org"]

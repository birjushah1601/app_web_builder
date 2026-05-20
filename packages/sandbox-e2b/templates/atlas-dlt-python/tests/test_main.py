"""Smoke tests for the atlas-dlt-python E2B template's FastAPI status app.

These run at template build time (Dockerfile RUN step + scripts/smoke-test-local.sh)
and verify that the FastAPI status app serves /health, /, /runs, /pipelines.
"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_endpoint_returns_ok():
    response = client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["stack"] == "dlt-python"
    assert payload["atlas"] == "sandbox-ready"


def test_root_endpoint_returns_metadata():
    response = client.get("/")
    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "Atlas Data Pipeline"
    assert payload["version"] == "0.1.0"
    assert payload["stack"] == "dlt-python"


def test_runs_endpoint_returns_list():
    response = client.get("/runs")
    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, dict)
    assert "runs" in payload
    assert isinstance(payload["runs"], list)


def test_pipelines_endpoint_lists_registered_pipelines():
    response = client.get("/pipelines")
    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, dict)
    assert "pipelines" in payload
    assert isinstance(payload["pipelines"], list)

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health_endpoint_returns_ok():
    response = client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["stack"] == "fastapi"
    assert payload["atlas"] == "sandbox-ready"


def test_docs_endpoint_returns_swagger_ui():
    response = client.get("/docs")
    assert response.status_code == 200
    assert "swagger" in response.text.lower() or "openapi" in response.text.lower()


def test_root_endpoint_returns_metadata():
    response = client.get("/")
    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "Atlas Sandbox"
    assert payload["version"] == "0.1.0"

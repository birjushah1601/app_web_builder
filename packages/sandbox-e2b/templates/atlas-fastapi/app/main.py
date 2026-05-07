from fastapi import FastAPI

app = FastAPI(title="Atlas Sandbox", version="0.1.0", description="FastAPI sandbox template for Atlas-generated backend code")


@app.get("/")
def root() -> dict[str, str]:
    return {"name": "Atlas Sandbox", "version": "0.1.0"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "stack": "fastapi", "atlas": "sandbox-ready"}

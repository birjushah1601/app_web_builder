# atlas-fastapi: Python 3.12 + FastAPI dev sandbox for Atlas live preview.
FROM e2bdev/code-interpreter:latest

USER root

# Install Python 3.12 + uv (the e2b base may have older Python).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3.12 python3.12-venv python3-pip curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && curl -LsSf https://astral.sh/uv/install.sh | sh \
 && cp /root/.local/bin/uv /usr/local/bin/uv

WORKDIR /code

# Hand-author the app structure so the build is deterministic.
RUN mkdir -p app tests

COPY pyproject.toml ./
COPY app/__init__.py app/main.py ./app/
COPY tests/__init__.py tests/test_main.py ./tests/

# Install via uv (creates .venv inside /code).
RUN uv sync --frozen 2>/dev/null || uv sync \
 && chown -R user:user /code

USER user

EXPOSE 3000

# Note: e2b.toml's start_cmd overrides this CMD at sandbox boot.
CMD ["sh", "-c", "uv run uvicorn app.main:app --host 0.0.0.0 --port 3000"]

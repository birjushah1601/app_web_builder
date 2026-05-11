# atlas-fastapi: Python 3.12 + FastAPI dev sandbox for Atlas live preview.
FROM e2bdev/code-interpreter:latest

USER root

# Install uv (handles its own Python toolchain — pulls Python 3.12 into ~/.local/share/uv/python).
# Avoids relying on apt for python3.12 (Debian Trixie repos don't ship it under that exact name).
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && curl -LsSf https://astral.sh/uv/install.sh | sh \
 && cp /root/.local/bin/uv /usr/local/bin/uv \
 && uv python install 3.12 \
 && cp -r /root/.local/share/uv /usr/local/share/uv \
 && chmod -R a+rx /usr/local/share/uv

ENV UV_PYTHON_INSTALL_DIR=/usr/local/share/uv/python

WORKDIR /code

# Hand-author the app structure so the build is deterministic.
RUN mkdir -p app tests

COPY pyproject.toml ./
COPY app/__init__.py ./app/__init__.py
COPY app/main.py ./app/main.py
COPY tests/__init__.py ./tests/__init__.py
COPY tests/test_main.py ./tests/test_main.py

# Install via uv (creates .venv inside /code, picks Python 3.12 from UV_PYTHON_INSTALL_DIR).
RUN uv sync --frozen 2>/dev/null || uv sync \
 && chown -R user:user /code

USER user

EXPOSE 3000

# Note: e2b.toml's start_cmd overrides this CMD at sandbox boot.
CMD ["/code/.venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3000"]

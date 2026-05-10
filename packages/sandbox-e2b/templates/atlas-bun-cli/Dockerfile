# atlas-bun-cli: Bun + Commander + ink CLI sandbox.
# Preview: tiny Bun.serve status page on port 3001. CLI itself is exercised
# via the E2B Exec API.
#
# Note on port: the e2bdev/code-interpreter base image already binds something
# on :3000 (jupyter / code-interpreter HTTP surface), so Bun.serve fails fast
# with EADDRINUSE if we try to use 3000. We bind to 3001 instead. Python
# templates (atlas-fastapi, atlas-dlt-python) are unaffected because uvicorn
# happens to start late enough that the conflict resolves itself; Bun.serve
# fails synchronously. See template-router.ts for the per-template port map.
FROM e2bdev/code-interpreter:latest

USER root

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates unzip \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://bun.sh/install | bash \
 && cp /root/.bun/bin/bun /usr/local/bin/bun

WORKDIR /code

RUN mkdir -p src/commands tests

COPY package.json ./
COPY tsconfig.json ./
COPY src/cli.ts ./src/cli.ts
COPY src/server.ts ./src/server.ts
COPY src/commands/hello.tsx ./src/commands/hello.tsx
COPY tests/cli.test.ts ./tests/cli.test.ts

RUN bun install \
 && chown -R user:user /code

USER user

ENV PORT=3001

EXPOSE 3001

CMD ["bun", "run", "src/server.ts"]

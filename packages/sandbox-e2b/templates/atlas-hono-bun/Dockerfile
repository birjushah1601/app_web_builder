# atlas-hono-bun: Bun 1.2 + Hono 4 + Drizzle ORM dev sandbox for Atlas live preview.
#
# Note on port: the e2bdev/code-interpreter base image already binds something
# on :3000 (jupyter / code-interpreter HTTP surface), so Bun.serve fails fast
# with EADDRINUSE if we try to use 3000. We bind to 3001 instead. See
# template-router.ts for the per-template port map.
FROM e2bdev/code-interpreter:latest

USER root

# Install Bun (the e2b base ships node, not bun).
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates unzip \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://bun.sh/install | bash \
 && cp /root/.bun/bin/bun /usr/local/bin/bun

WORKDIR /code

COPY package.json ./
COPY tsconfig.json ./

# Fresh install. Dev deps stay so the developer LLM can typecheck inside.
RUN bun install \
 && chown -R user:user /code

# Copy app source AFTER install for cache reuse on dep-only changes.
COPY src/ ./src/
COPY tests/ ./tests/

RUN chown -R user:user /code

USER user

ENV PORT=3001

EXPOSE 3001

# Note: e2b.toml's start_cmd overrides this CMD at sandbox boot.
CMD ["bun", "run", "src/index.ts"]

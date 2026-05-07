# atlas-bun-cli: Bun 1.2+ runtime + Commander + ink CLI scaffold for Atlas.
# Preview surface: a tiny Bun.serve status page on port 3000 so the canvas
# iframe has something to render. The CLI itself is exercised via the E2B
# Exec API (`sandbox.commands.run("bun run src/cli.ts hello --name X")`).
FROM oven/bun:1-alpine

USER root

# git/curl/ca-certificates for the dev loop and outbound HTTP sanity.
RUN apk add --no-cache git curl ca-certificates bash

WORKDIR /code

# Copy the manifest first to maximise Docker-layer cache hits on subsequent
# rebuilds when only src/ changes.
COPY package.json tsconfig.json ./

RUN bun install

# Then the source.
COPY src ./src
COPY tests ./tests

# E2B's ready_cmd hits this port; the iframe also points here.
EXPOSE 3000

# Note: e2b.toml's start_cmd overrides this CMD at sandbox boot. Keep this
# as a sensible default for `docker run` smoke tests.
CMD ["bun", "run", "src/server.ts"]

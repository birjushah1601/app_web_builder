# atlas-graphql-yoga: Bun 1.2+ + GraphQL Yoga 5 + Pothos 4 dev sandbox for Atlas live preview.
FROM oven/bun:1-alpine

WORKDIR /code

# Hand-author the app structure so the build is deterministic.
RUN mkdir -p src/schema tests

COPY package.json tsconfig.json ./
COPY src/server.ts ./src/
COPY src/schema/builder.ts src/schema/index.ts ./src/schema/
COPY tests/server.test.ts ./tests/

# Install via bun (creates node_modules + bun.lockb inside /code).
# --frozen-lockfile keeps the operator's lockfile authoritative; on first
# build (no lockfile present) bun installs without --frozen.
RUN bun install --frozen-lockfile 2>/dev/null || bun install

EXPOSE 3000

# Note: e2b.toml's start_cmd overrides this CMD at sandbox boot.
CMD ["bun", "run", "src/server.ts"]

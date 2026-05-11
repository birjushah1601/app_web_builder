# atlas-hono-bun: Bun 1.2 + Hono + Drizzle dev sandbox for Atlas live preview.
FROM oven/bun:1-alpine

# E2B's runtime overlay expects a `user` user with /code workdir + write perms.
RUN addgroup -S user && adduser -S -G user user \
 && mkdir -p /code \
 && chown -R user:user /code

WORKDIR /code

# Install deps as root for cache-friendly layer; switch to user for runtime.
COPY --chown=user:user package.json ./
COPY --chown=user:user tsconfig.json ./

# Fresh install (no lockfile committed in repo). Use `--production=false`
# implicitly via default, so dev deps (drizzle-kit, typescript) are present
# for the developer LLM's typecheck step.
RUN bun install

# Copy app source AFTER install for cache reuse on dep-only changes.
COPY --chown=user:user src/ ./src/
COPY --chown=user:user tests/ ./tests/

USER user

EXPOSE 3000

# Note: e2b.toml's start_cmd overrides this CMD at sandbox boot. CMD is
# kept for parity with `docker run` smoke tests outside e2b.
CMD ["bun", "run", "src/index.ts"]

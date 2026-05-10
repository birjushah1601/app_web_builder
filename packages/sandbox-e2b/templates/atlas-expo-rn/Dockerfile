# atlas-expo-rn: Expo SDK 52 + RN 0.76 + expo-router 4 + NativeWind 4 web build
# served at port 3000 for the E2B preview iframe. Native iOS/Android simulator
# preview is NOT supported in v1 — sandbox runs `expo start --web` only.
#
# IMPORTANT: pnpm install is INTENTIONALLY DEFERRED to runtime (e2b.toml
# start_cmd) rather than baked into the image. Expo SDK 52's transitive dep
# tree unpacks to >2 GB of node_modules + Metro caches, which exceeds E2B's
# template-build rootfs ceiling and fails with ENOSPC during `pnpm install`.
# Installing at sandbox boot uses the (larger) runtime rootfs and adds
# ~2-3 min of cold-start latency before `expo start --web` is ready. The
# tradeoff is acceptable for v1: the alternative (slimming Expo's deps) is
# fragile because Expo's Metro config pulls many of those packages
# transitively at start-time anyway.
FROM e2bdev/code-interpreter:latest

USER root

# Node 22 LTS + pnpm. Expo Metro needs git on PATH for some plugin paths.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs git \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@9

WORKDIR /code

RUN mkdir -p app "app/(tabs)" tests

# Per-file COPY (E2B CLI silently drops all but the first source in
# multi-source COPYs — same bug bit atlas-fastapi + atlas-dlt-python +
# atlas-next-ts). Keep one COPY per file.
COPY package.json ./package.json
COPY tsconfig.json ./tsconfig.json
COPY tailwind.config.js ./tailwind.config.js
COPY babel.config.js ./babel.config.js
COPY metro.config.js ./metro.config.js
COPY app.json ./app.json
COPY global.css ./global.css
COPY app ./app/
COPY tests ./tests/

# DO NOT `pnpm install` here — see the ENOSPC note at the top of the file.
# We still need /code to be writable by `user` so the runtime install can
# create node_modules and .expo caches under it.
RUN chown -R user:user /code

USER user

EXPOSE 3000

# Note: e2b.toml's start_cmd is the canonical entrypoint (it runs
# `pnpm install` first, then `expo start`). This CMD exists only so the
# image is locally smoke-testable via `docker run` AFTER an interactive
# `pnpm install` inside the container.
CMD ["pnpm", "expo", "start", "--web", "--port", "3000"]

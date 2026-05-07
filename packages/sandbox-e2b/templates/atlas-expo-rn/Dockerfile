# atlas-expo-rn: Expo SDK 52 + RN 0.76 + expo-router 4 + NativeWind 4 web build
# served at port 3000 for the E2B preview iframe. Native iOS/Android simulator
# preview is NOT supported in v1 - sandbox runs `expo start --web` only.
FROM node:22-alpine

# pnpm + system deps Expo / Metro need (git for some plugin install paths,
# bash for run scripts, libc6-compat for native modules built against glibc).
RUN apk add --no-cache git bash libc6-compat curl ca-certificates \
 && corepack enable \
 && corepack prepare pnpm@9.12.0 --activate

# Atlas convention: app code lives at /code, owned by `user`.
RUN addgroup -S user && adduser -S user -G user
WORKDIR /code

# Copy manifests first for cache-friendly layering.
COPY package.json ./
COPY pnpm-lock.yaml* ./

# Install deps.
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Copy the rest of the template.
COPY tsconfig.json app.json babel.config.js metro.config.js tailwind.config.js global.css ./
COPY app ./app
COPY tests ./tests

RUN chown -R user:user /code

USER user

EXPOSE 3000

# e2b.toml's start_cmd overrides this CMD at sandbox boot - kept here so the
# Dockerfile is also runnable standalone (smoke-test-local.sh uses it).
CMD ["sh", "-c", "pnpm expo start --web --port 3000 --no-dev"]

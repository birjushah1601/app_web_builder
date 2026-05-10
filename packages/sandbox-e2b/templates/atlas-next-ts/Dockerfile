# atlas-next-ts: Next.js 15 + Tailwind 3 + shadcn/ui dev sandbox for Atlas live preview.
#
# Hand-authored minimal Next.js app — no `create-next-app` scaffolding,
# which is interactive (asks about Turbopack) and broke E2B template
# builds running under non-TTY docker contexts.
FROM e2bdev/code-interpreter:latest

USER root

# Install Node 22 LTS (the e2b base ships with an older Node).
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@9

# Install Chromium + the libs puppeteer-core needs to launch headless.
# Used by @atlas/gate-visual-quality's screenshot.ts (eval'd inside the
# sandbox via sdk.commands.run). Canonical Debian dep list per
# https://pptr.dev/troubleshooting#chrome-doesnt-launch-on-linux.
# Image grows ~300 MB; acceptable for the live-preview sandbox.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium \
      libnss3 \
      libatk1.0-0 \
      libatk-bridge2.0-0 \
      libcups2 \
      libdrm2 \
      libxkbcommon0 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxrandr2 \
      libgbm1 \
      libpango-1.0-0 \
      libcairo2 \
      libasound2 \
      fonts-liberation \
 && rm -rf /var/lib/apt/lists/*

# Tell puppeteer-core where the chromium binary lives. The screenshot.ts
# script reads this env var (falling back to /usr/bin/chromium).
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /code

# Hand-author the app structure so the build is deterministic.
RUN mkdir -p src/app src/components/ui src/lib

# Top-level config files. Split per-file because E2B's CLI silently drops
# all but the first source in a multi-source COPY (same bug bit
# atlas-fastapi + atlas-dlt-python).
COPY package.json ./package.json
COPY tsconfig.json ./tsconfig.json
COPY next.config.mjs ./next.config.mjs
COPY tailwind.config.ts ./tailwind.config.ts
COPY postcss.config.js ./postcss.config.js
COPY components.json ./components.json

# Designer-role contract: tailwind.config.ts + design-tokens-style.tsx read
# this at build/HMR time. Developer role rewrites this file (whole-file
# replace, never patch) when a design direction has been picked. Schema
# documented in DESIGN-TOKENS.md.
COPY src/design-tokens.json ./src/design-tokens.json

# App router entries.
COPY src/app/layout.tsx ./src/app/layout.tsx
COPY src/app/page.tsx ./src/app/page.tsx
COPY src/app/globals.css ./src/app/globals.css
COPY src/app/design-tokens-style.tsx ./src/app/design-tokens-style.tsx

# shadcn primitives (11 components, one COPY each — globs also collapse to
# one source under E2B's build).
COPY src/components/ui/badge.tsx ./src/components/ui/badge.tsx
COPY src/components/ui/button.tsx ./src/components/ui/button.tsx
COPY src/components/ui/card.tsx ./src/components/ui/card.tsx
COPY src/components/ui/dialog.tsx ./src/components/ui/dialog.tsx
COPY src/components/ui/dropdown-menu.tsx ./src/components/ui/dropdown-menu.tsx
COPY src/components/ui/input.tsx ./src/components/ui/input.tsx
COPY src/components/ui/label.tsx ./src/components/ui/label.tsx
COPY src/components/ui/separator.tsx ./src/components/ui/separator.tsx
COPY src/components/ui/skeleton.tsx ./src/components/ui/skeleton.tsx
COPY src/components/ui/tabs.tsx ./src/components/ui/tabs.tsx
COPY src/components/ui/tooltip.tsx ./src/components/ui/tooltip.tsx

# Utility (cn helper).
COPY src/lib/utils.ts ./src/lib/utils.ts

# Install via pnpm (matches Atlas's monorepo PM choice).
RUN pnpm install --prod=false \
 && chown -R user:user /code

USER user

EXPOSE 3000

# Note: e2b.toml's start_cmd overrides this CMD at sandbox boot, but
# CMD is still useful for `docker run` smoke-testing the image locally.
CMD ["pnpm", "dev", "--hostname", "0.0.0.0", "--port", "3000"]

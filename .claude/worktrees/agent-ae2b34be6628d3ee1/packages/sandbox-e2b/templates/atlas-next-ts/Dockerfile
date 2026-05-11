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

WORKDIR /code

# Hand-author the app structure so the build is deterministic.
RUN mkdir -p src/app src/components/ui src/lib

# Top-level config files.
COPY package.json tsconfig.json next.config.mjs tailwind.config.ts postcss.config.js components.json ./

# App router entries.
COPY src/app/layout.tsx src/app/page.tsx src/app/globals.css ./src/app/

# shadcn primitives (11 components).
COPY src/components/ui/*.tsx ./src/components/ui/

# Utility (cn helper).
COPY src/lib/utils.ts ./src/lib/

# Install via pnpm (matches Atlas's monorepo PM choice).
RUN pnpm install --prod=false \
 && chown -R user:user /code

USER user

EXPOSE 3000

# Note: e2b.toml's start_cmd overrides this CMD at sandbox boot, but
# CMD is still useful for `docker run` smoke-testing the image locally.
CMD ["pnpm", "dev", "--hostname", "0.0.0.0", "--port", "3000"]

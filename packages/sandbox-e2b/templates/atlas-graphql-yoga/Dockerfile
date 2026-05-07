# atlas-graphql-yoga: Bun 1.2+ + GraphQL Yoga 5 + Pothos 4 dev sandbox.
FROM e2bdev/code-interpreter:latest

USER root

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates unzip \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://bun.sh/install | bash \
 && cp /root/.bun/bin/bun /usr/local/bin/bun

WORKDIR /code

RUN mkdir -p src/schema tests

COPY package.json ./
COPY tsconfig.json ./
COPY src/server.ts ./src/server.ts
COPY src/schema/builder.ts ./src/schema/builder.ts
COPY src/schema/index.ts ./src/schema/index.ts
COPY tests/server.test.ts ./tests/server.test.ts

RUN bun install \
 && chown -R user:user /code

USER user

EXPOSE 3000

CMD ["bun", "run", "src/server.ts"]

# atlas-expo-rn: Expo SDK 52 + RN 0.76 + expo-router 4 + NativeWind 4 web build
# served at port 3000 for the E2B preview iframe. Native iOS/Android simulator
# preview is NOT supported in v1 — sandbox runs `expo start --web` only.
FROM e2bdev/code-interpreter:latest

USER root

# Node 22 LTS + pnpm. Expo Metro needs git on PATH for some plugin paths.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs git \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@9

WORKDIR /code

RUN mkdir -p app "app/(tabs)" tests

COPY package.json ./
COPY tsconfig.json ./
COPY tailwind.config.js ./
COPY babel.config.js ./
COPY metro.config.js ./
COPY app.json ./
COPY global.css ./
COPY app/_layout.tsx ./app/_layout.tsx
COPY app/index.tsx ./app/index.tsx
COPY "app/(tabs)/_layout.tsx" "./app/(tabs)/_layout.tsx"
COPY "app/(tabs)/index.tsx" "./app/(tabs)/index.tsx"
COPY tests/index.test.tsx ./tests/index.test.tsx

RUN pnpm install --prod=false \
 && chown -R user:user /code

USER user

EXPOSE 3000

CMD ["pnpm", "expo", "start", "--web", "--port", "3000"]

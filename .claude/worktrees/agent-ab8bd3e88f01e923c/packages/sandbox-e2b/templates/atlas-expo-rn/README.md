# atlas-expo-rn E2B template

Expo SDK 52 + React Native 0.76+ + expo-router 4.x + NativeWind 4.x + TypeScript 5.6 (strict) + jest-expo.

Used by Atlas's developer role when the architect's `canvasManifest.artifactKind === "mobile-app"` AND `ATLAS_FF_MULTI_STACK=true`.

## Known v1 limitation: web-only preview

The sandbox **only** runs the **web build** of the Expo app (via `react-native-web`) on port 3000 so the canvas iframe can render it. iOS / Android simulator preview, deep-link / push-notification / camera / native-module testing are OUT OF SCOPE for v1.

This is acceptable because:
- The iframe-based E2B preview cannot host a simulator anyway.
- The developer LLM's diff is what we care about (correct RN component tree, correct NativeWind classes, correct expo-router file structure).
- The user can `git clone` the artifact and run `expo start --ios` / `--android` themselves once they're happy.

Native simulator support is tracked for v2 (Plan T.3.x).

## Pre-installed runtime deps

- **expo** ^52 - SDK + CLI + dev server (`expo start --web --port 3000`)
- **expo-router** ^4 - file-based routing (`app/_layout.tsx`, `app/index.tsx`, `app/(tabs)/`)
- **@expo/metro-runtime** ^4 - web runtime support
- **react** ^18.3 + **react-dom** ^18.3 - React runtime
- **react-native** ^0.76 - RN core
- **react-native-web** ^0.19 - bridges RN components to DOM in the iframe
- **nativewind** ^4 - Tailwind classes on RN (className prop on View, Text, etc.)

## Pre-installed dev deps

- **typescript** ^5.6 (strict)
- **jest** ^29 + **jest-expo** ^52 - test framework

## Out-of-the-box screens

- `app/_layout.tsx` - Expo Router root Stack
- `app/index.tsx` - smoke screen ("Atlas Expo Sandbox is live") with NativeWind className
- `app/(tabs)/_layout.tsx` - Tabs container example
- `app/(tabs)/index.tsx` - first tab smoke screen

## Local smoke test (no E2B credit)

```bash
cd packages/sandbox-e2b/templates/atlas-expo-rn
./scripts/smoke-test-local.sh
```

Expected: container boots in ~60-120s, `curl http://localhost:3000` returns the Expo web HTML.

## Build + push to E2B

```bash
cd packages/sandbox-e2b/templates/atlas-expo-rn
export E2B_API_KEY=e2b_...
./scripts/build-template.sh
# Capture the printed template ID; add it to e2b.toml's template_id; commit.
```

## Wire into atlas-web

When `ATLAS_FF_MULTI_STACK=true` AND architect classifies the project as `mobile-app`, the sandbox factory routes provisioning to this template automatically. Per-project override via `ATLAS_DEFAULT_SANDBOX_TEMPLATE=atlas-expo-rn`.

## Related plans

- Plan T.1 - multi-stack templates groundwork (router + registry + atlas-fastapi)
- Plan T.2.3 - this template (atlas-expo-rn)

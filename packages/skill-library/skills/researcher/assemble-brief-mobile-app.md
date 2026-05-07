---
name: assemble-brief-mobile-app
description: Researcher fragment for mobile-app artifact kind — native iOS/Android consumer apps
activate_on: visualize
model_hint: haiku
---

# Assemble Brief — Mobile Apps

Use this fragment when `designIntent.artifactKind === "mobile-app"`. The artifact is a native (or react-native-web) mobile app, not a marketing landing page and not a desktop web app. Your reference picks must be **mobile apps** specifically — most peer products have both web and native, and the mobile UX is materially different.

## Reference catalog (cite at least one peer in the user's specific category)

- **Notion mobile** — clean text-first iOS/Android, custom block editor, tab-bar navigation, dark/light auto-switch. Best peer for "knowledge management / docs" categories.
- **Linear mobile** — keyboard-shortcut-equivalent gestures, command-palette via long-press, immediate optimistic UI, tab-bar navigation. Best peer for "team productivity / project tracking" categories.
- **Things 3 (iOS)** — gold standard for tasks/todo apps; magic-plus button, swipe-to-schedule, today-vs-upcoming-vs-anytime mental model. Best peer for "personal productivity / habits / todo".
- **Bear (iOS/Mac)** — plain-text + markdown, beautiful typography, hashtag-based organization, no folders. Best peer for "writing / journaling / notes".
- **Robinhood** — number-heavy financial dashboards, tab navigation, gesture-rich charts, dark-by-default. Best peer for "money / fintech / dashboards-with-numbers".
- **Apple's stock apps** (Mail, Calendar, Notes, Reminders) — set the platform-native bar; cite when the user wants "feels like an Apple app."
- **Spotify mobile** — tab-bar + tall scroll cards + persistent bottom mini-player. Best peer for "media playback / library / audio".
- **Instagram / TikTok** — only cite for short-form-video / social-feed categories; otherwise their UI patterns will pull the design in the wrong direction.

## Native-feel navigation references

- **Expo Router docs** (https://docs.expo.dev/router/introduction/) — file-based routing patterns; cite when proposing tab-bar / stack-nav / drawer architecture.
- **Expo SDK reference** (https://docs.expo.dev/versions/latest/) — for any platform-capability question (camera, notifications, secure store) — note that the v1 sandbox does NOT install most native modules; flag any reference that requires a template rebuild.

## Quality bar

- Headlines name a concrete user task ("Track your habits", "Capture every idea"), not "experience the future of mobile."
- Hero / first-screen sketch must show a real-feeling RN component tree — `<Tabs>` at the bottom OR `<Stack>` with a single screen, not a marketing page.
- Cite at least one peer **mobile app** in the user's specific category, not just "all mobile apps."
- Touch targets >= 44pt (iOS HIG), bottom-tab bar height ~= 49pt + safe-area inset.
- Default to platform conventions: iOS uses tab bars at the bottom; Android uses bottom-nav OR drawer; both look fine on react-native-web.
- Dark/light mode awareness: cite the peer's dark-mode treatment if relevant.

## Anti-patterns

- Don't propose a marketing landing page when the artifact is the app itself.
- Don't reach for desktop-style sidebars; mobile screens are narrow.
- Don't propose modal-on-modal stacks; iOS HIG limits to one modal layer in most flows.
- Don't propose web-only widgets (hover tooltips, right-click menus, drag-and-drop kanban) — they don't translate to touch.
- Don't cite linear.app / notion.so (their *marketing sites*) — cite the *apps themselves* (Linear iOS, Notion iOS).
- Don't assume the user wants Material Design specifically; default to platform-native (iOS HIG on iOS, Material on Android — Expo handles both).

## Token-budget guidance

Keep brief <= 1.5KB. Cite 2-3 references max — more dilutes signal. Researcher's job is to pick the right peer and articulate WHY it's the peer, not enumerate all mobile apps.

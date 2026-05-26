import { describe, it, expect } from "vitest";
import {
  isFeatureEnabled,
  listFlagStates,
  type FeatureFlagSource
} from "@/lib/feature-flags";

const sourceWith = (env: Record<string, string>): FeatureFlagSource => ({
  readEnv: (name) => env[name]
});

const sourceWithCookies = (
  env: Record<string, string>,
  cookies: Record<string, string>
): FeatureFlagSource => ({
  readEnv: (name) => env[name],
  readCookie: (name) => cookies[name]
});

describe("isFeatureEnabled", () => {
  it("returns false when env var unset", () => {
    expect(isFeatureEnabled("figma-importer", sourceWith({}))).toBe(false);
  });

  it("returns true for truthy values", () => {
    for (const truthy of ["1", "true", "TRUE", "yes", "on"]) {
      expect(
        isFeatureEnabled(
          "figma-importer",
          sourceWith({ ATLAS_FF_FIGMA_IMPORTER: truthy })
        )
      ).toBe(true);
    }
  });

  it("returns false for falsy values", () => {
    for (const falsy of ["0", "false", "no", "off", ""]) {
      expect(
        isFeatureEnabled(
          "figma-importer",
          sourceWith({ ATLAS_FF_FIGMA_IMPORTER: falsy })
        )
      ).toBe(false);
    }
  });

  it("trims whitespace before evaluation", () => {
    expect(
      isFeatureEnabled(
        "stripe-payments",
        sourceWith({ ATLAS_FF_STRIPE_PAYMENTS: "  true  " })
      )
    ).toBe(true);
  });

  it("each flag reads its own env var (no cross-talk)", () => {
    const env = sourceWith({ ATLAS_FF_FIGMA_IMPORTER: "1" });
    expect(isFeatureEnabled("figma-importer", env)).toBe(true);
    expect(isFeatureEnabled("stripe-payments", env)).toBe(false);
    expect(isFeatureEnabled("video-kling", env)).toBe(false);
    expect(isFeatureEnabled("auth-keycloak", env)).toBe(false);
  });
});

describe("listFlagStates", () => {
  it("returns every flag's state", () => {
    const env = sourceWith({
      ATLAS_FF_FIGMA_IMPORTER: "0",
      ATLAS_FF_STRIPE_PAYMENTS: "1",
      ATLAS_FF_AUTH_KEYCLOAK: "true"
    });
    // Keep alphabetized to make drift obvious — adding a new flag should add
    // one line here. The set was last regenerated 2026-05-23 against the
    // current FeatureFlag union in lib/feature-flags.ts.
    expect(listFlagStates(env)).toEqual({
      "a11y-role": false,
      "asset-gen": false,
      "auth-keycloak": true,
      "auto-fix-loop": false,
      "build-gate": false,
      "canvas-v1": false,
      "click-to-edit": false,
      "demo-mode": false,
      "designer": false,
      "designer-critique": false,
      "editable-plan": false,
      "editor-layout-v2": false,
      "element-sliders": false,
      "figma-importer": false,
      "hero-ai-image": false,
      "hero-unsplash": false,
      "inline-edit-v1": false,
      "live-events": false,
      "mode-toolbar": false,
      "multi-stack": false,
      "multi-turn": false,
      "prompt-morph": false,
      "reference-images": false,
      "reference-input": false,
      "researcher": false,
      "ritual-hydration": false,
      "run-grafana": false,
      "sandbox-prewarm": false,
      "schema-architect": false,
      "schema-architect-3pass": false,
      "security-role": false,
      "stripe-payments": true,
      "structured-triage": false,
      "video-kling": false,
      "visual-quality-gate": false,
      "workflow": false
    });
  });
});

describe("auto-fix-loop flag (Plan L)", () => {
  it("is off when ATLAS_FF_AUTO_FIX_LOOP is unset", () => {
    expect(isFeatureEnabled("auto-fix-loop", sourceWith({}))).toBe(false);
  });
  it("is on when ATLAS_FF_AUTO_FIX_LOOP=true", () => {
    expect(
      isFeatureEnabled("auto-fix-loop", sourceWith({ ATLAS_FF_AUTO_FIX_LOOP: "true" }))
    ).toBe(true);
  });
  it("listFlagStates includes auto-fix-loop", () => {
    expect(listFlagStates(sourceWith({}))["auto-fix-loop"]).toBe(false);
  });
});

describe("multi-turn flag (Plan K)", () => {
  it("is off when ATLAS_FF_MULTI_TURN is unset", () => {
    expect(isFeatureEnabled("multi-turn", sourceWith({}))).toBe(false);
  });
  it("is on when ATLAS_FF_MULTI_TURN=true", () => {
    expect(
      isFeatureEnabled("multi-turn", sourceWith({ ATLAS_FF_MULTI_TURN: "true" }))
    ).toBe(true);
  });
  it("listFlagStates includes multi-turn", () => {
    expect(listFlagStates(sourceWith({}))["multi-turn"]).toBe(false);
  });
});

describe("run-grafana flag (Plan J)", () => {
  it("is off when ATLAS_FF_RUN_GRAFANA is unset", () => {
    expect(isFeatureEnabled("run-grafana", sourceWith({}))).toBe(false);
  });
  it("is on when ATLAS_FF_RUN_GRAFANA=true", () => {
    expect(
      isFeatureEnabled("run-grafana", sourceWith({ ATLAS_FF_RUN_GRAFANA: "true" }))
    ).toBe(true);
  });
  it("listFlagStates includes run-grafana", () => {
    expect(listFlagStates(sourceWith({}))["run-grafana"]).toBe(false);
  });
});

describe("security-role + a11y-role flags (Plan I)", () => {
  it("security-role reads ATLAS_FF_SECURITY_ROLE; off by default", () => {
    expect(isFeatureEnabled("security-role", sourceWith({}))).toBe(false);
    expect(
      isFeatureEnabled("security-role", sourceWith({ ATLAS_FF_SECURITY_ROLE: "true" }))
    ).toBe(true);
  });
  it("a11y-role reads ATLAS_FF_A11Y_ROLE; off by default", () => {
    expect(isFeatureEnabled("a11y-role", sourceWith({}))).toBe(false);
    expect(
      isFeatureEnabled("a11y-role", sourceWith({ ATLAS_FF_A11Y_ROLE: "true" }))
    ).toBe(true);
  });
  it("listFlagStates includes both", () => {
    const states = listFlagStates(sourceWith({}));
    expect(states["security-role"]).toBe(false);
    expect(states["a11y-role"]).toBe(false);
  });
});

describe("ritual-hydration flag (Plan H)", () => {
  it("is off when ATLAS_RITUAL_HYDRATION is unset", () => {
    expect(isFeatureEnabled("ritual-hydration", sourceWith({}))).toBe(false);
  });
  it("is on when ATLAS_RITUAL_HYDRATION=true", () => {
    expect(
      isFeatureEnabled("ritual-hydration", sourceWith({ ATLAS_RITUAL_HYDRATION: "true" }))
    ).toBe(true);
  });
  it("listFlagStates includes ritual-hydration", () => {
    expect(listFlagStates(sourceWith({}))["ritual-hydration"]).toBe(false);
  });
});

describe("demo-mode cookie precedence (Plan Q.UI)", () => {
  it("cookie ON beats env OFF", () => {
    expect(
      isFeatureEnabled(
        "demo-mode",
        sourceWithCookies({}, { "atlas-demo-mode": "true" })
      )
    ).toBe(true);
  });

  it("cookie OFF beats env ON", () => {
    expect(
      isFeatureEnabled(
        "demo-mode",
        sourceWithCookies(
          { ATLAS_FF_DEMO_MODE: "true" },
          { "atlas-demo-mode": "false" }
        )
      )
    ).toBe(false);
  });

  it("cookie unset → env wins (env ON)", () => {
    expect(
      isFeatureEnabled(
        "demo-mode",
        sourceWithCookies({ ATLAS_FF_DEMO_MODE: "true" }, {})
      )
    ).toBe(true);
  });

  it("cookie unset → env wins (env OFF)", () => {
    expect(
      isFeatureEnabled("demo-mode", sourceWithCookies({}, {}))
    ).toBe(false);
  });

  it("garbage cookie value falls through to env (does not silently disable)", () => {
    // A stale/corrupted cookie shouldn't override a deployed env config.
    expect(
      isFeatureEnabled(
        "demo-mode",
        sourceWithCookies(
          { ATLAS_FF_DEMO_MODE: "true" },
          { "atlas-demo-mode": "notaboolean" }
        )
      )
    ).toBe(true);
  });

  it("source without readCookie still works (backwards compatible)", () => {
    expect(
      isFeatureEnabled(
        "demo-mode",
        sourceWith({ ATLAS_FF_DEMO_MODE: "true" })
      )
    ).toBe(true);
  });

  it("env-only flags ignore the cookie layer", () => {
    // figma-importer has no FLAG_TO_COOKIE entry; even setting an
    // "atlas-figma-importer" cookie should not affect it.
    expect(
      isFeatureEnabled(
        "figma-importer",
        sourceWithCookies({}, { "atlas-figma-importer": "true" })
      )
    ).toBe(false);
  });
});

describe("live-events flag (Plan E.0)", () => {
  it("reads ATLAS_LIVE_EVENTS, NOT ATLAS_FF_LIVE_EVENTS (per spec)", () => {
    expect(
      isFeatureEnabled("live-events", sourceWith({ ATLAS_LIVE_EVENTS: "true" }))
    ).toBe(true);
    expect(
      isFeatureEnabled("live-events", sourceWith({ ATLAS_FF_LIVE_EVENTS: "true" }))
    ).toBe(false);
  });

  it("defaults to false when ATLAS_LIVE_EVENTS unset", () => {
    expect(isFeatureEnabled("live-events", sourceWith({}))).toBe(false);
  });

  it("accepts the same truthy values as other flags", () => {
    for (const truthy of ["1", "true", "TRUE", "yes", "on"]) {
      expect(
        isFeatureEnabled("live-events", sourceWith({ ATLAS_LIVE_EVENTS: truthy }))
      ).toBe(true);
    }
  });

  it("listFlagStates includes live-events", () => {
    const states = listFlagStates(sourceWith({ ATLAS_LIVE_EVENTS: "true" }));
    expect(states["live-events"]).toBe(true);
  });
});

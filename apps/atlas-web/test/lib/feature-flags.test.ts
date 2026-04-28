import { describe, it, expect } from "vitest";
import {
  isFeatureEnabled,
  listFlagStates,
  type FeatureFlagSource
} from "@/lib/feature-flags";

const sourceWith = (env: Record<string, string>): FeatureFlagSource => ({
  readEnv: (name) => env[name]
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
    expect(listFlagStates(env)).toEqual({
      "figma-importer": false,
      "stripe-payments": true,
      "video-kling": false,
      "auth-keycloak": true,
      "live-events": false,
      "ritual-hydration": false,
      "security-role": false,
      "a11y-role": false
    });
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

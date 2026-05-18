import { describe, it, expect } from "vitest";
import { ATLAS_ATTRS, buildAtlasResourceAttributes } from "../src/traceAttributes.js";

describe("ATLAS_ATTRS", () => {
  it("exports the documented attribute keys", () => {
    expect(ATLAS_ATTRS.PROJECT_ID).toBe("atlas.project_id");
    expect(ATLAS_ATTRS.ROLE_ID).toBe("atlas.role_id");
    expect(ATLAS_ATTRS.RITUAL_ID).toBe("atlas.ritual_id");
    expect(ATLAS_ATTRS.GATE_LAYER).toBe("atlas.gate_layer");
    expect(ATLAS_ATTRS.BRANCH_ID).toBe("atlas.branch_id");
    expect(ATLAS_ATTRS.LLM_PROVIDER).toBe("atlas.llm.provider");
    expect(ATLAS_ATTRS.LLM_MODEL).toBe("atlas.llm.model");
    expect(ATLAS_ATTRS.SKILL_NAME).toBe("atlas.skill.name");
  });
});

describe("buildAtlasResourceAttributes", () => {
  it("returns service.name + service.version + atlas.deploy_target keys", () => {
    const attrs = buildAtlasResourceAttributes({
      serviceName: "atlas-conductor",
      serviceVersion: "0.0.0",
      deployTarget: "production"
    });
    expect(attrs["service.name"]).toBe("atlas-conductor");
    expect(attrs["service.version"]).toBe("0.0.0");
    expect(attrs["atlas.deploy_target"]).toBe("production");
  });

  it("rejects empty serviceName", () => {
    expect(() =>
      buildAtlasResourceAttributes({ serviceName: "", serviceVersion: "0", deployTarget: "production" })
    ).toThrow();
  });
});

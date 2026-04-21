import { describe, it, expect } from "vitest";
import { E2BPreview } from "../src/preview.js";
import type { SandboxPreview } from "../src/preview.js";
import { SandboxIdSchema } from "../src/types.js";

const SANDBOX_ID = SandboxIdSchema.parse("sbx_preview_test");

describe("E2BPreview", () => {
  it("returns an https URL using the sandbox's base host and the given port", () => {
    const registry = new Map([
      [
        SANDBOX_ID as string,
        {
          getHost: (port: number) => `${port}-${SANDBOX_ID}.e2b.app`,
        },
      ],
    ]);
    const preview: SandboxPreview = new E2BPreview(registry);
    const url = preview.getPreviewUrl(SANDBOX_ID, 3000);
    expect(url).toBe("https://3000-sbx_preview_test.e2b.app");
  });

  it("supports arbitrary port numbers", () => {
    const registry = new Map([
      [
        SANDBOX_ID as string,
        { getHost: (port: number) => `${port}-${SANDBOX_ID}.e2b.app` },
      ],
    ]);
    const preview: SandboxPreview = new E2BPreview(registry);
    expect(preview.getPreviewUrl(SANDBOX_ID, 8000)).toBe("https://8000-sbx_preview_test.e2b.app");
    expect(preview.getPreviewUrl(SANDBOX_ID, 8080)).toBe("https://8080-sbx_preview_test.e2b.app");
  });

  it("throws SandboxNotFoundError for unknown sandbox id", () => {
    const preview: SandboxPreview = new E2BPreview(new Map());
    expect(() =>
      preview.getPreviewUrl(SandboxIdSchema.parse("sbx_ghost"), 3000)
    ).toThrow("SandboxNotFoundError");
  });
});

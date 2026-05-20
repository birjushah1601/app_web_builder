import { describe, it, expect, vi } from "vitest";
import { critiqueScreenshots, VQ_GATE_MODEL } from "../src/critique.js";
import { VisualQualityReportSchema } from "../src/types.js";

const fakeLLM = (toolReply: unknown) =>
  ({
    completeWithToolUse: vi.fn().mockResolvedValue({ toolName: "emit_visual_quality_report", input: toolReply })
  } as unknown as { completeWithToolUse: (...args: unknown[]) => Promise<unknown> });

const screenshots = {
  desktop: "data:image/jpeg;base64,DESKTOP_BYTES",
  tablet: "data:image/jpeg;base64,TABLET_BYTES",
  mobile: "data:image/jpeg;base64,MOBILE_BYTES"
};
const validReport = {
  passed: true,
  score: 88,
  issues: [],
  screenshotUrls: { ...screenshots }
};

describe("critiqueScreenshots", () => {
  it("returns a Zod-valid report on happy path", async () => {
    const llm = fakeLLM(validReport);
    const report = await critiqueScreenshots({
      llm: llm as never,
      composedPrompt: "## Skill: critique-design-tokens\n\n...",
      screenshots,
      tokens: { palette: { primary: "#0a0a0a", accent: "#fbbf24" }, typeScale: { serifFamily: "IBM Plex Serif" } }
    });
    expect(VisualQualityReportSchema.safeParse(report).success).toBe(true);
  });

  it("uses the configured model (default Sonnet)", async () => {
    const llm = fakeLLM(validReport);
    await critiqueScreenshots({ llm: llm as never, composedPrompt: "x", screenshots, tokens: {} });
    const args = (llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    const opts = args[1] as { model: string };
    expect(opts.model).toBe(VQ_GATE_MODEL);
  });

  it("includes 3 image content blocks (one per viewport)", async () => {
    const llm = fakeLLM(validReport);
    await critiqueScreenshots({ llm: llm as never, composedPrompt: "x", screenshots, tokens: {} });
    const args = (llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    const messages = args[0] as Array<{ role: string; content: string | Array<{ type: string }> }>;
    const userMsg = messages.find((m) => m.role === "user");
    if (!userMsg || typeof userMsg.content === "string") throw new Error("user content should be array");
    const imageBlocks = userMsg.content.filter((c) => c.type === "image");
    expect(imageBlocks).toHaveLength(3);
  });

  it("includes the chosen tokens in the user message text", async () => {
    const llm = fakeLLM(validReport);
    await critiqueScreenshots({ llm: llm as never, composedPrompt: "x", screenshots, tokens: { palette: { accent: "#fbbf24" } } });
    const args = (llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    const messages = args[0] as Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>;
    const userMsg = messages.find((m) => m.role === "user");
    if (!userMsg || typeof userMsg.content === "string") throw new Error("expected array");
    const textBlock = userMsg.content.find((c) => c.type === "text");
    expect(textBlock?.text).toContain("#fbbf24");
  });

  it("rejects malformed report from LLM (Zod fail)", async () => {
    const llm = fakeLLM({ totally: "wrong" });
    await expect(
      critiqueScreenshots({ llm: llm as never, composedPrompt: "x", screenshots, tokens: {} })
    ).rejects.toThrow();
  });

  it("respects ATLAS_VQ_GATE_MODEL override via constructor model arg", async () => {
    const llm = fakeLLM(validReport);
    await critiqueScreenshots({ llm: llm as never, composedPrompt: "x", screenshots, tokens: {}, model: "claude-haiku-4-5" });
    const args = (llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    expect((args[1] as { model: string }).model).toBe("claude-haiku-4-5");
  });
});

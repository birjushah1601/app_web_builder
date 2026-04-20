import { describe, it, expect } from "vitest";
import { GoogleProvider } from "../src/google.js";

describe("GoogleProvider (D.1 stub)", () => {
  it("is constructable but complete() throws a clear 'deferred to D.3' error", async () => {
    const provider = new GoogleProvider({ apiKey: "fake" });
    expect(provider.name).toBe("google");
    await expect(provider.complete([{ role: "user", content: "hi" }], { model: "gemini-2.5-flash", maxTokens: 100 }))
      .rejects.toThrow(/deferred to D\.3/);
  });

  it("stream() throws the same deferred error", async () => {
    const provider = new GoogleProvider({ apiKey: "fake" });
    const iter = provider.stream([{ role: "user", content: "hi" }], { model: "gemini-2.5-flash", maxTokens: 100 });
    await expect((async () => { for await (const _ of iter) { /* drain */ } })())
      .rejects.toThrow(/deferred to D\.3/);
  });
});

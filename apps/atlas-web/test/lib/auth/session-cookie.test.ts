import { describe, it, expect } from "vitest";
import { sealSession, unsealSession, SessionSealError } from "@/lib/auth/session-cookie";

const SECRET = "a".repeat(32);

describe("sealSession", () => {
  it("rejects secrets shorter than 32 chars", async () => {
    await expect(
      sealSession({ sub: "u", email: "e@a" }, { secret: "short" })
    ).rejects.toThrow(SessionSealError);
  });

  it("returns a payload.signature-shaped token", async () => {
    const token = await sealSession({ sub: "user-1" }, { secret: SECRET });
    expect(token.split(".").length).toBe(2);
  });
});

describe("unsealSession", () => {
  it("round-trips claims", async () => {
    const token = await sealSession(
      { sub: "user-1", email: "user@atlas.app", name: "User" },
      { secret: SECRET }
    );
    const claims = await unsealSession(token, { secret: SECRET });
    expect(claims.sub).toBe("user-1");
    expect(claims.email).toBe("user@atlas.app");
    expect(claims.name).toBe("User");
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await sealSession({ sub: "u" }, { secret: SECRET });
    const otherSecret = "b".repeat(32);
    await expect(unsealSession(token, { secret: otherSecret })).rejects.toThrow(SessionSealError);
  });

  it("rejects a tampered token", async () => {
    const token = await sealSession({ sub: "u" }, { secret: SECRET });
    const [_p, s] = token.split(".");
    const evilPayload = Buffer.from(
      JSON.stringify({ sub: "evil", iat: 0, exp: 9999999999 }),
      "utf8"
    ).toString("base64url");
    const tampered = `${evilPayload}.${s}`;
    await expect(unsealSession(tampered, { secret: SECRET })).rejects.toThrow(SessionSealError);
  });

  it("rejects a malformed token (not 2 parts)", async () => {
    await expect(unsealSession("onlyonepart", { secret: SECRET })).rejects.toThrow(
      SessionSealError
    );
  });

  it("rejects a token that has expired", async () => {
    const token = await sealSession({ sub: "u" }, { secret: SECRET, maxAgeSec: -1 });
    await expect(unsealSession(token, { secret: SECRET })).rejects.toThrow(SessionSealError);
  });

  it("honors a custom maxAgeSec", async () => {
    const token = await sealSession({ sub: "u" }, { secret: SECRET, maxAgeSec: 60 });
    const claims = await unsealSession(token, { secret: SECRET });
    expect(claims.exp - claims.iat).toBe(60);
  });
});

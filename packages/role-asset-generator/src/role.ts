import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import type { AssetGenInput, AssetManifest } from "./types.js";
import { gradientFallback } from "./gradient-fallback.js";

export interface AssetGeneratorRoleOptions {
  /** OpenAI API key — required when ATLAS_FF_HERO_AI_IMAGE=true. */
  openaiKey?: string;
  /** Unsplash access key — required when ATLAS_FF_HERO_UNSPLASH=true. */
  unsplashKey?: string;
  /** Injection seam — atlas-web wires this to its image-cache util.
   *  Returns a stable URL pointing at the cached jpg. Required only when
   *  the gpt-image path is selected. */
  writeImage?: (buf: Buffer) => Promise<string>;
  /** Test-only fetch impl injection. */
  fetchImpl?: typeof fetch;
}

/**
 * Role that produces an `AssetManifest` (hero image + section images) for
 * the Developer to render. Tries three sources in priority order:
 *   1. gpt-image-1     (when ATLAS_FF_HERO_AI_IMAGE=true + openaiKey set)
 *   2. Unsplash search (when ATLAS_FF_HERO_UNSPLASH=true + unsplashKey set)
 *   3. gradient stub   (always — empty URLs, Developer falls back to tokens)
 *
 * The role NEVER throws — failures collapse to the gradient fallback and
 * emit `asset.gen.failed`.
 */
export class AssetGeneratorRole implements Role {
  readonly id = "asset-generator";

  constructor(private readonly opts: AssetGeneratorRoleOptions = {}) {}

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    // Fold the conductor's userTurn into the input so the image-prompt
    // builder can use it as subject matter. The engine passes priorArtifact
    // = { proposal, brief, projectId }; merging userTurn here keeps the
    // engine wiring untouched.
    const input: AssetGenInput = {
      ...(inv.priorArtifact as AssetGenInput),
      ...(typeof inv.userTurn === "string" && inv.userTurn.length > 0 ? { userTurn: inv.userTurn } : {})
    };
    const events: RoleOutput["events"] = [];
    const aiOn =
      process.env.ATLAS_FF_HERO_AI_IMAGE === "true" && typeof this.opts.openaiKey === "string" && this.opts.openaiKey.length > 0;
    const unsplashOn =
      process.env.ATLAS_FF_HERO_UNSPLASH === "true" && typeof this.opts.unsplashKey === "string" && this.opts.unsplashKey.length > 0;

    events.push({ eventType: "asset.gen.started", payload: { aiOn, unsplashOn } });

    let manifest: AssetManifest;
    try {
      manifest = await this.generate({ aiOn, unsplashOn, input });
      events.push({ eventType: "asset.gen.completed", payload: { manifest } });
      return withArtifact({ events, diff: { kind: "none" } }, { assetManifest: manifest });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      events.push({ eventType: "asset.gen.failed", payload: { error: message } });
      const fallback = gradientFallback(input);
      return withArtifact({ events, diff: { kind: "none" } }, { assetManifest: fallback });
    }
  }

  /**
   * Inner dispatcher — cascades gpt-image-1 → Unsplash → gradient. If the
   * higher-priority source throws, the role emits `asset.gen.failed` for
   * the user-visible signal and then attempts the next source rather than
   * dropping straight to gradient. Each fallback emits its own
   * `asset.gen.fallback` event so the rail timeline can show what
   * actually happened.
   */
  protected async generate(args: { aiOn: boolean; unsplashOn: boolean; input: AssetGenInput }): Promise<AssetManifest> {
    let lastErr: unknown;

    if (args.aiOn) {
      try {
        const { gptImagePass } = await import("./gpt-image-pass.js");
        const writeImage = this.opts.writeImage;
        if (!writeImage) {
          throw new Error("asset-generator: writeImage dep required when ATLAS_FF_HERO_AI_IMAGE=true");
        }
        return await gptImagePass(args.input, {
          apiKey: this.opts.openaiKey!,
          writeImage,
          ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {})
        });
      } catch (err) {
        lastErr = err;
        // Continue to Unsplash / gradient — don't surface here; the outer
        // catch in run() will emit asset.gen.failed if we exhaust all
        // sources. If a fallback succeeds, the user sees an image.
      }
    }

    if (args.unsplashOn) {
      try {
        const { unsplashPass } = await import("./unsplash-pass.js");
        return await unsplashPass(args.input, {
          apiKey: this.opts.unsplashKey!,
          ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {})
        });
      } catch (err) {
        lastErr = err;
      }
    }

    // If every higher-priority branch threw, surface the most recent
    // error to the caller — run() catches and emits asset.gen.failed,
    // then renders the gradient stub. Suppress when no branch ran (both
    // flags off) so the gradient is the clean default.
    if (lastErr !== undefined) throw lastErr;
    return gradientFallback(args.input);
  }
}

/**
 * RoleOutput's schema is `{ events, diff }`, but role chains expect an
 * `artifact` field on the runtime object too (the engine reads it via
 * `(output as any).artifact` in some paths and via event payloads in
 * others). Attach the artifact as an extra runtime property without
 * fighting the `RoleOutput` type.
 */
function withArtifact(base: RoleOutput, artifact: { assetManifest: AssetManifest }): RoleOutput {
  return { ...base, artifact } as RoleOutput & { artifact: { assetManifest: AssetManifest } };
}

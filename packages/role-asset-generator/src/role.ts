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
    const input = inv.priorArtifact as AssetGenInput;
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
   * Inner dispatcher — kept as a protected method so each branch stays
   * isolated from the `run()` envelope (event emission + try/catch).
   * Priority: gpt-image-1 > Unsplash > gradient stub.
   */
  protected async generate(args: { aiOn: boolean; unsplashOn: boolean; input: AssetGenInput }): Promise<AssetManifest> {
    if (args.aiOn) {
      const { gptImagePass } = await import("./gpt-image-pass.js");
      const writeImage = this.opts.writeImage;
      if (!writeImage) {
        throw new Error("asset-generator: writeImage dep required when ATLAS_FF_HERO_AI_IMAGE=true");
      }
      return gptImagePass(args.input, {
        apiKey: this.opts.openaiKey!,
        writeImage,
        ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {})
      });
    }
    if (args.unsplashOn) {
      const { unsplashPass } = await import("./unsplash-pass.js");
      return unsplashPass(args.input, {
        apiKey: this.opts.unsplashKey!,
        ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {})
      });
    }
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

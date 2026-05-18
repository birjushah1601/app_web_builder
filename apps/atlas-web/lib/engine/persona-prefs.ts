import type { PersonaPreferences, PersonaTier } from "@atlas/ritual-engine";
import type { PreferencesRepo } from "@atlas/spec-graph-data";

const VALID = new Set<PersonaTier>(["ama", "diego", "priya"]);

export class ClerkPersonaPreferences implements PersonaPreferences {
  constructor(
    private readonly repo: PreferencesRepo,
    private readonly fetchUser: (userId: string) => Promise<{ publicMetadata?: { defaultPersona?: unknown } } | null>
  ) {}

  async getPersona(userId: string, projectId: string): Promise<PersonaTier> {
    const override = await this.repo.getOverride(userId, projectId);
    if (override && VALID.has(override)) return override;
    const user = await this.fetchUser(userId);
    const fromClerk = user?.publicMetadata?.defaultPersona;
    if (typeof fromClerk === "string" && VALID.has(fromClerk as PersonaTier)) {
      return fromClerk as PersonaTier;
    }
    return "ama";
  }
}

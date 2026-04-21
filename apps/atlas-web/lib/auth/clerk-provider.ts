import { auth, currentUser } from "@clerk/nextjs/server";
import type { AuthProvider } from "./provider";

export class ClerkAuthProvider implements AuthProvider {
  async getCurrentUserId(): Promise<string | null> {
    const { userId } = await auth();
    return userId ?? null;
  }
  async getCurrentUserEmail(): Promise<string | null> {
    const u = await currentUser();
    return u?.emailAddresses[0]?.emailAddress ?? null;
  }
  signInUrl(returnTo: string): string {
    return `/sign-in?redirect_url=${encodeURIComponent(returnTo)}`;
  }
}

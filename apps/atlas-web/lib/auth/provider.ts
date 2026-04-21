export interface AuthProvider {
  getCurrentUserId(): Promise<string | null>;
  getCurrentUserEmail(): Promise<string | null>;
  signInUrl(returnTo: string): string;
}

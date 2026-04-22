"use client";

import { useState } from "react";
import { createShareableUrl, type AccessMode } from "@/lib/actions/sandbox";

interface ShareableUrlModalProps {
  projectId: string;
  sandboxId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ShareableUrlModal({
  projectId,
  sandboxId,
  isOpen,
  onClose,
}: ShareableUrlModalProps) {
  const [accessMode, setAccessMode] = useState<AccessMode>("auth");
  const [password, setPassword] = useState("");
  const [publicConfirmed, setPublicConfirmed] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleCreate() {
    setLoading(true);
    setError(null);
    try {
      const result = await createShareableUrl({
        projectId,
        sandboxId,
        accessMode,
        passwordPlaintext: accessMode === "password" ? password : undefined,
      });
      setGeneratedUrl(result.url);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const canCreate =
    accessMode === "auth" ||
    (accessMode === "password" && password.length >= 4) ||
    (accessMode === "public" && publicConfirmed);

  return (
    <div role="dialog" aria-modal="true" aria-label="Share preview" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background rounded-xl shadow-xl p-6 w-full max-w-md space-y-4">
        <h2 className="text-lg font-semibold">Share preview</h2>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Access mode</legend>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="accessMode"
              value="auth"
              checked={accessMode === "auth"}
              onChange={() => setAccessMode("auth")}
              aria-label="Requires sign-in"
            />
            <span>Requires sign-in (recommended)</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="accessMode"
              value="password"
              checked={accessMode === "password"}
              onChange={() => setAccessMode("password")}
              aria-label="Password"
            />
            <span>Password-protected</span>
          </label>

          {accessMode === "password" && (
            <div className="ml-6">
              <label htmlFor="shared-password" className="text-sm">
                Shared password
              </label>
              <input
                id="shared-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full rounded border px-3 py-1.5 text-sm"
                aria-label="Shared password"
              />
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="accessMode"
              value="public"
              checked={accessMode === "public"}
              onChange={() => { setAccessMode("public"); setPublicConfirmed(false); }}
              aria-label="Public"
            />
            <span>Public (no auth required)</span>
          </label>

          {accessMode === "public" && (
            <div className="ml-6">
              <label className="flex items-center gap-2 text-sm text-destructive cursor-pointer">
                <input
                  type="checkbox"
                  checked={publicConfirmed}
                  onChange={(e) => setPublicConfirmed(e.target.checked)}
                  aria-label="I understand this URL will be accessible to anyone with the link"
                />
                I understand this URL will be accessible to anyone with the link
              </label>
            </div>
          )}
        </fieldset>

        {generatedUrl && (
          <div className="rounded bg-muted p-3 text-sm break-all select-all">
            {generatedUrl}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate || loading}
            className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {generatedUrl ? "Regenerate" : "Create link"}
          </button>
        </div>
      </div>
    </div>
  );
}

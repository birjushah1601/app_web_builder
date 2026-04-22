"use client";

import React, { useEffect, useState } from "react";
import { listPrs, type Pr } from "../../lib/actions/code/listPrs";
import { openPr } from "../../lib/actions/code/openPr";
import { getPrDiff } from "../../lib/actions/code/getPrDiff";
import { PrDiffViewer } from "./PrDiffViewer";
import { PrCommentThread } from "./PrCommentThread";

export interface PrPaneProps {
  projectId: string;
  repoSlug: string;
}

export function PrPane({ projectId, repoSlug }: PrPaneProps) {
  const [prs, setPrs] = useState<Pr[]>([]);
  const [selectedPr, setSelectedPr] = useState<Pr | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [showOpenForm, setShowOpenForm] = useState(false);
  const [newPrTitle, setNewPrTitle] = useState("");
  const [newPrHead, setNewPrHead] = useState("");
  const [newPrBase, setNewPrBase] = useState("main");
  const [opening, setOpening] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listPrs({ projectId, repoSlug, state: "open" })
      .then(setPrs)
      .finally(() => setLoading(false));
  }, [projectId, repoSlug]);

  async function handleSelectPr(pr: Pr) {
    setSelectedPr(pr);
    setDiff(null);
    const result = await getPrDiff({ projectId, repoSlug, prNumber: pr.number });
    setDiff(result.diff);
  }

  async function handleOpenPr() {
    setOpening(true);
    try {
      const result = await openPr({
        projectId,
        repoSlug,
        head: newPrHead,
        base: newPrBase,
        title: newPrTitle,
      });
      window.open(result.prUrl, "_blank");
      setShowOpenForm(false);
      // Refresh PR list
      const refreshed = await listPrs({ projectId, repoSlug, state: "open" });
      setPrs(refreshed);
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden text-sm text-zinc-200">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-700 px-3 py-2">
        <span className="font-medium">Pull Requests</span>
        <button
          onClick={() => setShowOpenForm((v) => !v)}
          className="rounded bg-blue-600 px-2 py-0.5 text-xs hover:bg-blue-500"
        >
          Open PR
        </button>
      </div>

      {/* Open PR form */}
      {showOpenForm && (
        <div className="flex flex-col gap-1 border-b border-zinc-700 px-3 pb-3">
          <input
            placeholder="Head branch"
            value={newPrHead}
            onChange={(e) => setNewPrHead(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500"
          />
          <input
            placeholder="Base branch (default: main)"
            value={newPrBase}
            onChange={(e) => setNewPrBase(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500"
          />
          <input
            placeholder="PR title"
            value={newPrTitle}
            onChange={(e) => setNewPrTitle(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500"
          />
          <button
            onClick={handleOpenPr}
            disabled={opening || !newPrTitle || !newPrHead}
            className="self-end rounded bg-green-600 px-3 py-1 text-xs text-white hover:bg-green-500 disabled:opacity-40"
          >
            {opening ? "Opening…" : "Create PR"}
          </button>
        </div>
      )}

      {/* PR list */}
      <div className="flex-1 overflow-y-auto">
        {loading && <p className="px-3 text-xs text-zinc-500">Loading…</p>}
        {!loading && prs.length === 0 && (
          <p className="px-3 text-xs text-zinc-500">No open pull requests.</p>
        )}
        <ul>
          {prs.map((pr) => (
            <li key={pr.number}>
              <button
                onClick={() => handleSelectPr(pr)}
                className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-zinc-800 ${
                  selectedPr?.number === pr.number ? "bg-zinc-800" : ""
                }`}
              >
                <span className="font-medium">{pr.title}</span>
                <span className="text-xs text-zinc-400">
                  #{pr.number} · {pr.head.ref} → {pr.base.ref}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {/* Diff viewer for selected PR */}
        {selectedPr && diff && (
          <div className="mt-2 h-64 border-t border-zinc-700">
            <PrDiffViewer diff={diff} />
          </div>
        )}
        {selectedPr && diff === null && (
          <p className="px-3 py-2 text-xs text-zinc-500">Loading diff…</p>
        )}

        {/* Comment thread for selected PR */}
        {selectedPr && (
          <PrCommentThread
            projectId={projectId}
            repoSlug={repoSlug}
            prNumber={selectedPr.number}
            comments={[]}
          />
        )}
      </div>
    </div>
  );
}

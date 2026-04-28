"use client";

import React, { useState } from "react";
import { postPrComment } from "../../lib/actions/code/postPrComment";

export interface PrComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
}

export interface PrCommentThreadProps {
  projectId: string;
  repoSlug: string;
  prNumber: number;
  comments: PrComment[];
  onCommentPosted?: (id: number) => void;
}

export function PrCommentThread({
  projectId,
  repoSlug,
  prNumber,
  comments,
  onCommentPosted,
}: PrCommentThreadProps) {
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePost() {
    if (!body.trim()) return;
    setPosting(true);
    setError(null);
    try {
      const result = await postPrComment({ projectId, repoSlug, prNumber, body });
      setBody("");
      onCommentPosted?.(result.commentId);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      {comments.map((c) => (
        <div key={c.id} className="rounded border border-zinc-700 bg-zinc-800 p-2 text-sm">
          <div className="mb-1 flex items-center justify-between text-xs text-zinc-400">
            <span className="font-medium text-zinc-200">{c.author}</span>
            <span>{c.createdAt}</span>
          </div>
          <p className="whitespace-pre-wrap text-zinc-300">{c.body}</p>
        </div>
      ))}

      <div className="mt-2 flex flex-col gap-1">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Leave a comment…"
          rows={3}
          className="rounded border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          onClick={handlePost}
          disabled={posting || !body.trim()}
          className="self-end rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-40"
        >
          {posting ? "Posting…" : "Comment"}
        </button>
      </div>
    </div>
  );
}

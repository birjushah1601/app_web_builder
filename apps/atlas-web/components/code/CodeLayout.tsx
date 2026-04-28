"use client";

import React, { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { FileTreeClient } from "./FileTreeClient";
import { RightPane } from "./RightPane";
import { openFile } from "../../lib/actions/code/openFile";

// MonacoPane is already ssr: false internally, but CodeLayout is a Client Component
// that orchestrates state — it imports MonacoPane directly (no additional dynamic needed).
const MonacoPane = dynamic(
  () => import("./MonacoPane").then((m) => ({ default: m.MonacoPane })),
  { ssr: false }
);

export interface CodeLayoutProps {
  projectId: string;
  repoSlug: string;
  /** Initial file list from the Server Component above (FileTree.tsx) */
  files: string[];
}

interface OpenedFile {
  filePath: string;
  content: string;
  language: string;
}

/**
 * Client Component — three-pane shell for the Code view.
 *
 *   ┌──────────────┬───────────────────────────┬──────────────┐
 *   │   FileTree   │       Monaco Editor        │  Right Pane  │
 *   │  (16rem min) │       (flex: 1)            │  (22rem min) │
 *   │              │                            │  PR/Term/    │
 *   │              │                            │  Tests tabs  │
 *   └──────────────┴───────────────────────────┴──────────────┘
 *
 * File content is loaded lazily when the user clicks a file in the tree.
 */
export function CodeLayout({ projectId, repoSlug, files }: CodeLayoutProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [openedFile, setOpenedFile] = useState<OpenedFile | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  const handleSelectFile = useCallback(
    async (filePath: string) => {
      if (filePath === selectedFile) return;
      setSelectedFile(filePath);
      setLoadingFile(true);
      try {
        const result = await openFile({ projectId, filePath });
        setOpenedFile({ filePath, content: result.content, language: result.language });
      } catch {
        setOpenedFile({ filePath, content: "", language: "plaintext" });
      } finally {
        setLoadingFile(false);
      }
    },
    [projectId, selectedFile]
  );

  return (
    <div className="flex h-full w-full overflow-hidden bg-zinc-950 text-zinc-200">
      {/* File tree — left sidebar */}
      <aside className="w-56 min-w-[10rem] max-w-xs shrink-0 border-r border-zinc-700">
        <FileTreeClient
          files={files}
          selectedFile={selectedFile}
          onSelectFile={handleSelectFile}
        />
      </aside>

      {/* Monaco editor — center pane */}
      <main className="relative flex flex-1 flex-col overflow-hidden">
        {loadingFile && (
          <div className="flex h-full items-center justify-center text-xs text-zinc-500">
            Loading file…
          </div>
        )}
        {!loadingFile && openedFile && (
          <MonacoPane
            projectId={projectId}
            filePath={openedFile.filePath}
            content={openedFile.content}
            language={openedFile.language}
          />
        )}
        {!loadingFile && !openedFile && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-600">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
            </svg>
            <p className="text-sm">Select a file to edit</p>
          </div>
        )}
      </main>

      {/* Right pane — PR / Terminal / Tests */}
      <aside className="w-80 min-w-[18rem] max-w-sm shrink-0">
        <RightPane projectId={projectId} repoSlug={repoSlug} />
      </aside>
    </div>
  );
}

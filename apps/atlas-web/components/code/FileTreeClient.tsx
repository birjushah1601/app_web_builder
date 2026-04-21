"use client";

import React from "react";

export interface FileTreeClientProps {
  files: string[];
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
}

function fileName(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

/**
 * Client Component. Holds no async data — receives the file list from the
 * parent Server Component (FileTree.tsx) and manages selected-file state.
 */
export function FileTreeClient({ files, selectedFile, onSelectFile }: FileTreeClientProps) {
  return (
    <nav className="h-full overflow-y-auto bg-zinc-900 py-2 text-sm text-zinc-300">
      <ul>
        {files.map((filePath) => (
          <li key={filePath}>
            <button
              onClick={() => onSelectFile(filePath)}
              title={filePath}
              className={`flex w-full items-center gap-2 truncate px-3 py-1 text-left hover:bg-zinc-800 ${
                filePath === selectedFile ? "bg-zinc-700 text-white" : ""
              }`}
            >
              <span className="truncate">{fileName(filePath)}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

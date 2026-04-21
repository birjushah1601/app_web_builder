import React from "react";
import { listMirroredFiles } from "@atlas/spec-graph-sync";
import { FileTreeClient } from "./FileTreeClient.js";

export interface FileTreeProps {
  projectId: string;
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
}

/**
 * Server Component — fetches file list from @atlas/spec-graph-sync at request time.
 * Delegates interactivity to FileTreeClient (Client Component).
 */
export async function FileTree({ projectId, selectedFile, onSelectFile }: FileTreeProps) {
  const files = await listMirroredFiles({ projectId });
  return (
    <FileTreeClient
      files={files}
      selectedFile={selectedFile}
      onSelectFile={onSelectFile}
    />
  );
}

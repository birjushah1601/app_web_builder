"use client";

import React, { useCallback } from "react";
import dynamic from "next/dynamic";
import { saveFile } from "../../lib/actions/code/saveFile";
import type { EditClass } from "@atlas/ritual-engine";

// Monaco depends on browser globals — must be loaded with ssr: false
const MonacoEditorWrapper = dynamic(
  () =>
    import("./MonacoEditorWrapper").then((m) => ({ default: m.MonacoEditorWrapper })),
  { ssr: false, loading: () => <div className="flex h-full items-center justify-center text-zinc-500 text-sm">Loading editor…</div> }
);

export interface MonacoPaneProps {
  projectId: string;
  filePath: string;
  content: string;
  language: string;
}

/**
 * Client Component. Loads MonacoEditorWrapper via next/dynamic (ssr: false),
 * wires the save handler (Server Action + RitualEngine).
 */
export function MonacoPane({ projectId, filePath, content, language }: MonacoPaneProps) {
  const handleSave = useCallback(
    async ({
      content: newContent,
      filePath: fp,
      editClass,
    }: {
      content: string;
      filePath: string;
      editClass: EditClass;
    }) => {
      // 1. Persist through spec-graph-sync
      await saveFile({ projectId, filePath: fp, content: newContent });
      // 2. TODO(E.4): kick off ritual via RitualEngine.start({ userTurn: `edit ${fp}`, editClass, projectId, userId })
      //    RitualEngine requires conductor + eventSink + personaPreferences wired by E.4.
      void editClass;
    },
    [projectId]
  );

  return (
    <div className="h-full w-full">
      <MonacoEditorWrapper
        projectId={projectId}
        filePath={filePath}
        initialContent={content}
        language={language}
        onSave={handleSave}
      />
    </div>
  );
}

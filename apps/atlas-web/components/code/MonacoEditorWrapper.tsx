"use client";

import React, { useState, useCallback } from "react";
import Editor from "@monaco-editor/react";
import { classifyEdit } from "../../lib/code/editClassifier";
import type { EditClass } from "@atlas/ritual-engine";

export interface MonacoEditorWrapperProps {
  projectId: string;
  filePath: string;
  initialContent: string;
  language: string;
  readOnly?: boolean;
  onSave?: (args: { content: string; filePath: string; editClass: EditClass }) => void;
}

/**
 * Client Component. Wraps @monaco-editor/react with:
 * - dirty-state tracking
 * - save button (Ctrl+S / click)
 * - edit-class heuristic classification on save
 *
 * Loaded only via next/dynamic with ssr: false from MonacoPane.tsx.
 */
export function MonacoEditorWrapper({
  projectId: _projectId,
  filePath,
  initialContent,
  language,
  readOnly = false,
  onSave,
}: MonacoEditorWrapperProps) {
  const [content, setContent] = useState(initialContent);
  const isDirty = content !== initialContent;

  const handleSave = useCallback(() => {
    if (!onSave || !isDirty) return;
    const editClass = classifyEdit({
      filePath,
      oldContent: initialContent,
      newContent: content,
    });
    onSave({ content, filePath, editClass });
  }, [content, filePath, initialContent, isDirty, onSave]);

  return (
    <div className="relative flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-400">
        <span className="truncate">{filePath}</span>
        <div className="flex items-center gap-2">
          {isDirty && (
            <span
              data-testid="dirty-indicator"
              className="h-2 w-2 rounded-full bg-amber-400"
              title="Unsaved changes"
            />
          )}
          {!readOnly && (
            <button
              onClick={handleSave}
              disabled={!isDirty}
              className="rounded bg-zinc-700 px-2 py-0.5 hover:bg-zinc-600 disabled:opacity-40"
            >
              Save
            </button>
          )}
        </div>
      </div>

      {/* Monaco */}
      <div className="flex-1 overflow-hidden">
        <Editor
          data-testid="monaco-editor"
          height="100%"
          language={language}
          value={content}
          onChange={(v) => setContent(v ?? "")}
          theme="vs-dark"
          options={{
            readOnly,
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            wordWrap: "off",
            scrollBeyondLastLine: false,
          }}
        />
      </div>
    </div>
  );
}

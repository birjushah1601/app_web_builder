"use client";
import * as React from "react";
import { ChatPanel, type ChatPanelProps } from "@/components/ChatPanel";
import { editElementWithAI } from "@/lib/actions/editElementWithAI";

export function ChatPanelWithSelectionChip(props: ChatPanelProps) {
  const [chip, setChip] = React.useState<{ label: string; atlasId: string; filePath: string } | null>(null);
  React.useEffect(() => {
    function onSet(e: Event) {
      const d = (e as CustomEvent).detail as { label?: string; atlasId?: string; filePath?: string } | undefined;
      if (d && d.label && d.atlasId && d.filePath) {
        setChip({ label: d.label, atlasId: d.atlasId, filePath: d.filePath });
      }
    }
    window.addEventListener("atlas:set-chat-selection", onSet as EventListener);
    return () => window.removeEventListener("atlas:set-chat-selection", onSet as EventListener);
  }, []);
  return (
    <ChatPanel
      {...props}
      {...(chip !== null ? { selectionChip: chip } : {})}
      onClearSelection={() => setChip(null)}
      editElementAction={editElementWithAI}
    />
  );
}

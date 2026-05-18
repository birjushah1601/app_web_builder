import React from "react";

/**
 * Code view layout. Enforces full-viewport height so the three-pane shell
 * can fill the screen without a scrollbar on the outer shell.
 *
 * Intentionally does NOT import the Canvas layout — per constraint "Do NOT
 * touch E.2's Canvas view code." Each view owns its own layout subtree.
 */
export default function CodeViewLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      {children}
    </div>
  );
}

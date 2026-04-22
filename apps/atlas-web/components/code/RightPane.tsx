"use client";

import React, { useState } from "react";
import { PrPane } from "./PrPane";
import { TerminalPane } from "./TerminalPane";
import { TestRunnerPane } from "./TestRunnerPane";

type Tab = "pr" | "terminal" | "tests";

export interface RightPaneProps {
  projectId: string;
  repoSlug: string;
}

export function RightPane({ projectId, repoSlug }: RightPaneProps) {
  const [activeTab, setActiveTab] = useState<Tab>("pr");

  const tabs: { id: Tab; label: string }[] = [
    { id: "pr", label: "PR" },
    { id: "terminal", label: "Terminal" },
    { id: "tests", label: "Tests" },
  ];

  return (
    <div className="flex h-full flex-col border-l border-zinc-700 bg-zinc-900">
      {/* Tab strip */}
      <div className="flex border-b border-zinc-700" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? "border-b-2 border-blue-500 text-white"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Active panel */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "pr" && <PrPane projectId={projectId} repoSlug={repoSlug} />}
        {activeTab === "terminal" && <TerminalPane projectId={projectId} />}
        {activeTab === "tests" && <TestRunnerPane projectId={projectId} />}
      </div>
    </div>
  );
}

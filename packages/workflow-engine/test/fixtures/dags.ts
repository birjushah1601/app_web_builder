// test/fixtures/dags.ts
import type { WorkflowNode } from "../../src/types.js";

const policy = { priority: 0, runMode: "active" as const };

export function chain(): WorkflowNode[] {
  return [
    { id: "a", artifactKind: "frontend-app", summary: "a", dependsOn: [], consumes: [], policy, status: "pending" },
    { id: "b", artifactKind: "frontend-app", summary: "b", dependsOn: ["a"], consumes: ["a"], policy, status: "pending" },
    { id: "c", artifactKind: "frontend-app", summary: "c", dependsOn: ["b"], consumes: ["b"], policy, status: "pending" }
  ];
}

export function fanOut(): WorkflowNode[] {
  return [
    { id: "a", artifactKind: "frontend-app", summary: "a", dependsOn: [], consumes: [], policy, status: "pending" },
    { id: "b", artifactKind: "frontend-app", summary: "b", dependsOn: ["a"], consumes: ["a"], policy, status: "pending" },
    { id: "c", artifactKind: "frontend-app", summary: "c", dependsOn: ["a"], consumes: ["a"], policy, status: "pending" }
  ];
}

export function fanIn(): WorkflowNode[] {
  return [
    { id: "a", artifactKind: "frontend-app", summary: "a", dependsOn: [], consumes: [], policy, status: "pending" },
    { id: "b", artifactKind: "frontend-app", summary: "b", dependsOn: [], consumes: [], policy, status: "pending" },
    { id: "c", artifactKind: "frontend-app", summary: "c", dependsOn: ["a", "b"], consumes: ["a", "b"], policy, status: "pending" }
  ];
}

export function diamond(): WorkflowNode[] {
  return [
    { id: "a", artifactKind: "frontend-app", summary: "a", dependsOn: [], consumes: [], policy, status: "pending" },
    { id: "b", artifactKind: "frontend-app", summary: "b", dependsOn: ["a"], consumes: ["a"], policy, status: "pending" },
    { id: "c", artifactKind: "frontend-app", summary: "c", dependsOn: ["a"], consumes: ["a"], policy, status: "pending" },
    { id: "d", artifactKind: "frontend-app", summary: "d", dependsOn: ["b", "c"], consumes: ["b", "c"], policy, status: "pending" }
  ];
}

export function withCycle(): WorkflowNode[] {
  return [
    { id: "a", artifactKind: "frontend-app", summary: "a", dependsOn: ["c"], consumes: ["c"], policy, status: "pending" },
    { id: "b", artifactKind: "frontend-app", summary: "b", dependsOn: ["a"], consumes: ["a"], policy, status: "pending" },
    { id: "c", artifactKind: "frontend-app", summary: "c", dependsOn: ["b"], consumes: ["b"], policy, status: "pending" }
  ];
}

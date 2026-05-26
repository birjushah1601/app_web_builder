// src/errors.ts

export class WorkflowNotFoundError extends Error {
  constructor(workflowRunId: string) {
    super(`WorkflowRun not found: ${workflowRunId}`);
    this.name = "WorkflowNotFoundError";
  }
}

export class WorkflowAlreadyApprovedError extends Error {
  constructor(workflowRunId: string, currentStatus: string) {
    super(
      `WorkflowRun ${workflowRunId} cannot be approved; current status is "${currentStatus}"`
    );
    this.name = "WorkflowAlreadyApprovedError";
  }
}

export class NodeNotFoundError extends Error {
  constructor(workflowRunId: string, nodeId: string) {
    super(`Node "${nodeId}" not found in workflow run ${workflowRunId}`);
    this.name = "NodeNotFoundError";
  }
}

export class InvalidNodePolicyEditError extends Error {
  constructor(nodeId: string, reason: string) {
    super(`Cannot edit policy for node "${nodeId}": ${reason}`);
    this.name = "InvalidNodePolicyEditError";
  }
}

-- Plan F.3 — persist DeployOrchestrator.deployFromArtifacts result per node.
-- Null = node has not run a runtime deploy (today's default).
ALTER TABLE workflow_nodes ADD COLUMN deploy_result jsonb;

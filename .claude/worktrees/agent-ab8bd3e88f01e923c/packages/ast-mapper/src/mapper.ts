import type { AstMapFile, NodeAstMapping } from "./types.js";

/** Interface every concrete mapper implements. */
export interface AstMapper {
  /** Resolve the AST ranges that produce the given graph node id. */
  rangesForNode(nodeId: string): NodeAstMapping | undefined;
  /** All known mappings. */
  list(): NodeAstMapping[];
  /** The graph hash this mapper was built from — used for drift detection. */
  graphHash(): string;
}

/**
 * In-memory mapper backed by an `AstMapFile`. Concrete mappers (TS Compiler API,
 * Babel, swc) load files from disk + AST-walk to produce the map; this class
 * is the consumer-facing read API.
 */
export class FileBackedAstMapper implements AstMapper {
  private readonly byNodeId: Map<string, NodeAstMapping>;
  private readonly hash: string;

  constructor(file: AstMapFile) {
    this.byNodeId = new Map(file.mappings.map((m) => [m.nodeId, m]));
    this.hash = file.graphHash;
  }

  rangesForNode(nodeId: string): NodeAstMapping | undefined {
    return this.byNodeId.get(nodeId);
  }

  list(): NodeAstMapping[] {
    return [...this.byNodeId.values()];
  }

  graphHash(): string {
    return this.hash;
  }
}

/**
 * Stub mapper for use before a concrete TS Compiler integration ships.
 * Returns `undefined` for every node id — callers must handle the
 * "no mapping available" case, which surfaces as an empty AST-range panel
 * in the Canvas UI.
 */
export class NullAstMapper implements AstMapper {
  rangesForNode(): undefined {
    return undefined;
  }
  list(): NodeAstMapping[] {
    return [];
  }
  graphHash(): string {
    return "sha256:" + "0".repeat(64);
  }
}

export const PACKAGE_NAME = "@atlas/spec-graph-sync";

// ---------------------------------------------------------------------------
// File-mirror helpers — used by atlas-web Server Actions (E.3)
// E.4 replaces these stubs with real file-system I/O from the E2B sandbox.
// ---------------------------------------------------------------------------

export interface ListMirroredFilesInput {
  projectId: string;
}

export interface ReadMirroredFileInput {
  projectId: string;
  filePath: string;
}

export interface WriteMirroredFileInput {
  projectId: string;
  filePath: string;
  content: string;
}

/**
 * Returns the list of file paths mirrored for the given project.
 * Stub: returns an empty array. E.4 wires real mirror storage.
 */
export async function listMirroredFiles(
  _input: ListMirroredFilesInput
): Promise<string[]> {
  return [];
}

/**
 * Reads the content of a mirrored file.
 * Stub: throws ENOENT. E.4 wires real mirror storage.
 */
export async function readMirroredFile(
  _input: ReadMirroredFileInput
): Promise<string> {
  const err = Object.assign(new Error("ENOENT: file not found in mirror"), {
    code: "ENOENT",
  });
  throw err;
}

/**
 * Writes content to a mirrored file.
 * Stub: no-op. E.4 wires real mirror storage.
 */
export async function writeMirroredFile(
  _input: WriteMirroredFileInput
): Promise<void> {
  // TODO(E.4): persist to mirror storage
}

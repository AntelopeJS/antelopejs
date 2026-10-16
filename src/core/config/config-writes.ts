import { createHash } from "node:crypto";
import path from "node:path";

const HASH_ALGORITHM = "sha256";

/** What the runtime last wrote to each file, by resolved path. */
const ownWrites = new Map<string, string>();

function digest(content: string): string {
  return createHash(HASH_ALGORITHM).update(content).digest("hex");
}

/**
 * Remembers that the runtime itself wrote `content` to `filePath`, a change
 * it has already applied: the watcher must not restart the project for it.
 */
export function recordOwnConfigWrite(filePath: string, content: string): void {
  ownWrites.set(path.resolve(filePath), digest(content));
}

/**
 * Whether `content` is what the runtime itself last wrote to `filePath`.
 * The record is consumed: a later edit of the same file is the user's.
 */
export function consumeOwnConfigWrite(
  filePath: string,
  content: string,
): boolean {
  const resolved = path.resolve(filePath);
  const recorded = ownWrites.get(resolved);
  ownWrites.delete(resolved);
  return recorded === digest(content);
}

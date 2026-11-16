import { createHash } from "node:crypto";
import path from "node:path";

const HASH_ALGORITHM = "sha256";

/**
 * The runtime's own writes to each file, by resolved path: the hash of the
 * content each write edited, mapped to the hash of the content it wrote.
 */
const ownWrites = new Map<string, Map<string, string>>();

function digest(content: string): string {
  return createHash(HASH_ALGORITHM).update(content).digest("hex");
}

/**
 * Remembers that the runtime itself turned `read` into `written` in
 * `filePath`, a change it has already applied: the watcher must not restart
 * the project for it.
 */
export function recordOwnConfigWrite(
  filePath: string,
  read: string,
  written: string,
): void {
  const resolved = path.resolve(filePath);
  const writes = ownWrites.get(resolved) ?? new Map<string, string>();
  writes.set(digest(read), digest(written));
  ownWrites.set(resolved, writes);
}

/**
 * Whether the runtime's own writes alone turned `filePath` from the content
 * hashed `previousHash` into the content hashed `currentHash`, both SHA-256
 * hex digests of the file. The writes on that path are consumed. A change
 * any other edit took part in is the user's, even when the runtime wrote the
 * file last.
 */
export function consumeOwnConfigWrite(
  filePath: string,
  previousHash: string | undefined,
  currentHash: string | undefined,
): boolean {
  const writes = ownWrites.get(path.resolve(filePath));
  const walked: string[] = [];
  let hash = previousHash;
  while (hash !== currentHash) {
    if (hash === undefined || walked.includes(hash)) {
      return false;
    }
    const written = writes?.get(hash);
    if (written === undefined) {
      return false;
    }
    walked.push(hash);
    hash = written;
  }
  for (const read of walked) {
    writes?.delete(read);
  }
  return walked.length > 0;
}

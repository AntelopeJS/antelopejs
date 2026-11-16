import { createHash } from "node:crypto";
import path from "node:path";

const HASH_ALGORITHM = "sha256";

/**
 * The runtime's own writes to each file, by resolved path: the hashes of the
 * contents an unbroken run of own writes went through, oldest first. Each
 * write edited the content before it.
 */
const ownWrites = new Map<string, string[]>();

function digest(content: string | Uint8Array): string {
  return createHash(HASH_ALGORITHM).update(content).digest("hex");
}

/**
 * Remembers that the runtime itself turned `read` into `written` in
 * `filePath`, a change it has already applied: the watcher must not restart
 * the project for it. `read` is the file as it was on disk, bytes included.
 */
export function recordOwnConfigWrite(
  filePath: string,
  read: string | Uint8Array,
  written: string,
): void {
  const resolved = path.resolve(filePath);
  const readHash = digest(read);
  const run = ownWrites.get(resolved);
  const continued = run?.at(-1) === readHash ? run : [readHash];
  ownWrites.set(resolved, [...continued, digest(written)]);
}

/**
 * Whether the runtime's own writes alone turned `filePath` from the content
 * hashed `previousHash` into the content hashed `currentHash`, both SHA-256
 * hex digests of the file. The writes up to `currentHash` are consumed. A
 * change any other edit took part in is the user's, even when the runtime
 * wrote the file last, and it forgets every own write on that path.
 */
export function consumeOwnConfigWrite(
  filePath: string,
  previousHash: string | undefined,
  currentHash: string | undefined,
): boolean {
  const resolved = path.resolve(filePath);
  const run = ownWrites.get(resolved) ?? [];
  const from = previousHash === undefined ? -1 : run.lastIndexOf(previousHash);
  const to =
    from < 0 || currentHash === undefined
      ? -1
      : run.indexOf(currentHash, from + 1);
  if (to < 0) {
    ownWrites.delete(resolved);
    return false;
  }
  ownWrites.set(resolved, run.slice(to));
  return true;
}

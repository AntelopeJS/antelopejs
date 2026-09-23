import {
  areVariantsWithin,
  getPathResolutionCacheGeneration,
  getPathVariants,
} from "./package-resolution";

export interface PathOwnerRoot<T> {
  root: string;
  owner: T;
}

interface IndexedRoot<T> extends PathOwnerRoot<T> {
  variants: string[];
}

/**
 * Finds which root owns a file: the longest root containing it, the first
 * listed root winning ties.
 *
 * Root path variants and per-file answers are cached until `invalidate` is
 * called or the `realpath` cache is cleared, so repeated lookups cost no
 * filesystem calls.
 */
export class PathOwnerIndex<T> {
  private indexedRoots?: IndexedRoot<T>[];
  private readonly ownerByFile = new Map<string, T | undefined>();
  private generation = getPathResolutionCacheGeneration();

  constructor(private readonly listRoots: () => Iterable<PathOwnerRoot<T>>) {}

  invalidate(): void {
    this.indexedRoots = undefined;
    this.ownerByFile.clear();
  }

  findOwner(filePath: string): T | undefined {
    this.invalidateIfStale();
    if (this.ownerByFile.has(filePath)) {
      return this.ownerByFile.get(filePath);
    }
    const owner = this.findLongestRoot(filePath)?.owner;
    this.ownerByFile.set(filePath, owner);
    return owner;
  }

  private invalidateIfStale(): void {
    const generation = getPathResolutionCacheGeneration();
    if (generation === this.generation) {
      return;
    }
    this.generation = generation;
    this.invalidate();
  }

  private findLongestRoot(filePath: string): IndexedRoot<T> | undefined {
    const fileVariants = getPathVariants(filePath);
    let match: IndexedRoot<T> | undefined;
    for (const candidate of this.getIndexedRoots()) {
      if (
        candidate.root.length > (match?.root.length ?? 0) &&
        areVariantsWithin(fileVariants, candidate.variants)
      ) {
        match = candidate;
      }
    }
    return match;
  }

  private getIndexedRoots(): IndexedRoot<T>[] {
    this.indexedRoots ??= [...this.listRoots()].map((entry) => ({
      ...entry,
      variants: getPathVariants(entry.root),
    }));
    return this.indexedRoots;
  }
}

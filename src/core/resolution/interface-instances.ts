import path from "node:path";
import { createHash } from "node:crypto";

import {
  createInstanceCopy,
  nextInstanceCopyPath,
  removeInstanceCopy,
} from "./instance-copies";
import { createPathWithinMatcher } from "./package-resolution";
import type { BindingGraph, InstanceDescriptor } from "./binding-graph-types";

const NODE_MODULES = "node_modules";
const INSTANCES_FOLDER = ".ajs-instances";
const KEY_HASH_LENGTH = 16;

/** Where an interface package's canonical copy lives. */
export interface CanonicalPackage {
  root: string;
  realRoot: string;
}

interface InstanceCopy {
  root: string;
  generation: string;
}

function evictFolder(folder: string): void {
  const isInFolder = createPathWithinMatcher(folder);
  for (const filePath of Object.keys(require.cache)) {
    if (isInFolder(filePath)) {
      delete require.cache[filePath];
    }
  }
}

function hashKey(key: string): string {
  return createHash("sha256")
    .update(key)
    .digest("hex")
    .slice(0, KEY_HASH_LENGTH);
}

function nearestNodeModules(folder: string): string | undefined {
  let current = folder;
  while (path.dirname(current) !== current) {
    if (path.basename(current) === NODE_MODULES) {
      return current;
    }
    current = path.dirname(current);
  }
  return undefined;
}

function relocate(
  filePath: string,
  from: string,
  to: string,
): string | undefined {
  const relative = path.relative(from, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  return path.join(to, relative);
}

/**
 * The folder each interface instance is evaluated from.
 *
 * The first instance of a package, in key order, uses the package's canonical
 * copy. Every further instance gets an instance copy of it, created when it is
 * first needed next to the canonical copy's `node_modules`, so the package's
 * own third-party dependencies still resolve, shared, from there.
 */
export class InterfaceInstances {
  private descriptors = new Map<string, InstanceDescriptor>();
  private keysByPackage = new Map<string, string[]>();
  private canonical = new Map<string, CanonicalPackage>();
  private fixedRoots = new Map<string, string>();
  private readonly copies = new Map<string, InstanceCopy>();

  constructor(private readonly onRootsChanged: () => void) {}

  /**
   * Replaces the instances with those of `graph`, for the packages in
   * `canonical`. `fixedRoots` pins instances to a folder of their own: an
   * interface package that is its own provider module is evaluated from that
   * module's folder.
   */
  update(
    graph: BindingGraph,
    canonical: ReadonlyMap<string, CanonicalPackage>,
    fixedRoots: ReadonlyMap<string, string> = new Map(),
  ) {
    this.canonical = new Map(canonical);
    this.fixedRoots = new Map(fixedRoots);
    this.descriptors = new Map(
      [...graph.instances].filter(([, { interfaceName }]) =>
        canonical.has(interfaceName),
      ),
    );
    this.keysByPackage = new Map();
    for (const [key, { interfaceName }] of this.descriptors) {
      const keys = this.keysByPackage.get(interfaceName) ?? [];
      keys.push(key);
      this.keysByPackage.set(interfaceName, keys.sort());
    }
    this.onRootsChanged();
  }

  describe(key: string): InstanceDescriptor | undefined {
    return this.descriptors.get(key);
  }

  keysOf(packageName: string): readonly string[] {
    return this.keysByPackage.get(packageName) ?? [];
  }

  isCanonical(key: string): boolean {
    const descriptor = this.descriptors.get(key);
    return (
      descriptor !== undefined &&
      this.keysOf(descriptor.interfaceName)[0] === key
    );
  }

  /** The folder `key` is evaluated from, creating its copy on first use. */
  rootOf(key: string): string | undefined {
    const descriptor = this.descriptors.get(key);
    const canonical =
      descriptor && this.canonical.get(descriptor.interfaceName);
    if (!descriptor || !canonical) {
      return undefined;
    }
    const fixed = this.fixedRoots.get(key);
    if (fixed) {
      return fixed;
    }
    if (this.isCanonical(key)) {
      return canonical.realRoot;
    }
    return (
      this.copies.get(key)?.root ?? this.createCopy(key, descriptor, canonical)
    );
  }

  /** `canonicalFile`, a file of the package's canonical copy, as it sits in the instance `key`. */
  locate(key: string, canonicalFile: string): string | undefined {
    const descriptor = this.descriptors.get(key);
    const canonical =
      descriptor && this.canonical.get(descriptor.interfaceName);
    const root = this.rootOf(key);
    if (!canonical || !root) {
      return undefined;
    }
    return (
      relocate(canonicalFile, canonical.realRoot, root) ??
      relocate(canonicalFile, canonical.root, root)
    );
  }

  /** Instance roots in use so far, keyed by instance. */
  roots(): Map<string, string> {
    const roots = new Map<string, string>();
    for (const [key, { interfaceName }] of this.descriptors) {
      const root =
        this.fixedRoots.get(key) ??
        (this.isCanonical(key)
          ? this.canonical.get(interfaceName)?.realRoot
          : this.copies.get(key)?.root);
      if (root) {
        roots.set(key, root);
      }
    }
    return roots;
  }

  /** Evicts and deletes every instance copy. */
  release(): void {
    for (const { generation } of this.copies.values()) {
      evictFolder(generation);
      removeInstanceCopy(generation);
    }
    this.copies.clear();
    this.onRootsChanged();
  }

  private createCopy(
    key: string,
    descriptor: InstanceDescriptor,
    canonical: CanonicalPackage,
  ): string {
    const anchor =
      nearestNodeModules(canonical.realRoot) ??
      path.dirname(canonical.realRoot);
    const base = path.join(anchor, INSTANCES_FOLDER, hashKey(key));
    const generation = nextInstanceCopyPath(base);
    const root = path.join(
      generation,
      NODE_MODULES,
      ...descriptor.interfaceName.split("/"),
    );
    createInstanceCopy(canonical.realRoot, root);
    this.copies.set(key, { root, generation });
    this.onRootsChanged();
    return root;
  }
}

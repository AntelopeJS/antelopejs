import assert from "node:assert/strict";
import path from "node:path";

import fc from "fast-check";
import sinon from "sinon";

import { FileWatcher } from "../../src/core/runtime";
import {
  WATCH_RETRY_DELAY_MS,
  WATCH_RETRY_LIMIT,
} from "../../src/core/runtime/watch/missing-folders";
import { FolderWorld } from "./watch-folder-world";

const project = path.resolve("/proj");
const moduleRoot = path.join(project, "modules", "mod");

export const folderNames = [
  "project",
  "modules",
  "mod",
  "src",
  "deep",
  "lib",
  "nodeModules",
] as const;

export type FolderName = (typeof folderNames)[number];

/** The folders the operations act on, from the project folder down to a nested one. */
export const folders: Record<FolderName, string> = {
  project,
  modules: path.join(project, "modules"),
  mod: moduleRoot,
  src: path.join(moduleRoot, "src"),
  deep: path.join(moduleRoot, "src", "deep"),
  lib: path.join(moduleRoot, "lib"),
  nodeModules: path.join(moduleRoot, "node_modules"),
};

const filledFolders: FolderName[] = [
  "mod",
  "src",
  "deep",
  "lib",
  "nodeModules",
];
const parkingLot = path.resolve("/parked");

/** One step of a scenario: a change to the file system, or a pause. */
export type Operation =
  | {
      kind: "delete" | "recreate" | "moveAway" | "moveBack";
      target: FolderName;
    }
  | { kind: "watchFails" | "watchErrors"; target: FolderName }
  | { kind: "tick" };

/** A watch configuration and the operations applied to the module's folders. */
export interface Scenario {
  watchDirs: readonly string[];
  operations: Operation[];
  startAfter: number;
  /** Lets `moveAway` move a folder above a scanned root, which the watcher cannot see. */
  moveAncestors?: boolean;
  /** Lets `watchFails` hit a watched folder, which `FileWatcher` never retries. */
  failWatched?: boolean;
  /** Applies each operation before the watcher handled the events of the previous one. */
  overlap?: boolean;
}

function isFailure(operation: Operation): boolean {
  return operation.kind === "watchFails" || operation.kind === "watchErrors";
}

/** The most injected failures a scenario may hold: more would make the watcher give up on purpose. */
export const FAILURE_BUDGET = WATCH_RETRY_LIMIT;

const structuralKinds = ["delete", "recreate", "moveAway", "moveBack"] as const;
const failureKinds = ["watchFails", "watchErrors"] as const;

const operation: fc.Arbitrary<Operation> = fc.oneof(
  ...structuralKinds.map((kind) => ({
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant(kind),
      target: fc.constantFrom(...folderNames),
    }),
  })),
  ...failureKinds.map((kind) => ({
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant(kind),
      target: fc.constantFrom(...folderNames),
    }),
  })),
  { weight: 1, arbitrary: fc.constant<Operation>({ kind: "tick" }) },
);

export const scenario: fc.Arbitrary<Scenario> = fc
  .record({
    watchDirs: fc.constantFrom([""], ["src"], ["src", "lib"], ["src/deep"]),
    operations: fc.array(operation, { minLength: 1, maxLength: 12 }),
    startAfter: fc.nat(4),
  })
  .filter(
    ({ operations }) => operations.filter(isFailure).length <= FAILURE_BUDGET,
  );

export const scenarioParameters = {
  seed: Number(process.env.FC_SEED ?? 20261116),
  numRuns: 200,
};

function parked(target: FolderName): string {
  return path.join(parkingLot, target);
}

function populate(world: FolderWorld, target: FolderName): void {
  for (const name of folderNames) {
    if (isInside(folders[name], folders[target])) {
      world.createDirectory(folders[name]);
      if (filledFolders.includes(name)) {
        world.putFile(path.join(folders[name], "f.txt"), "initial");
      }
    }
  }
}

function isInside(candidate: string, folder: string): boolean {
  return candidate === folder || candidate.startsWith(`${folder}${path.sep}`);
}

/** The folders a failure may hit: ancestors of every scanned root, which only `MissingFolders` watches. */
function isAncestorOfAnyRoot(target: FolderName, roots: string[]): boolean {
  return roots.some(
    (root) => root !== folders[target] && isInside(root, folders[target]),
  );
}

function isAncestorOfEveryRoot(target: FolderName, roots: string[]): boolean {
  return roots.every(
    (root) => root !== folders[target] && isInside(root, folders[target]),
  );
}

function apply(
  world: FolderWorld,
  {
    operation: step,
    roots,
    moveAncestors,
    failWatched,
  }: {
    operation: Operation;
    roots: string[];
    moveAncestors: boolean;
    failWatched: boolean;
  },
): void {
  if (step.kind === "tick") {
    return;
  }
  const folder = folders[step.target];
  switch (step.kind) {
    case "delete":
      world.removeTree(folder);
      return;
    case "recreate":
      if (!world.hasDirectory(folder)) {
        populate(world, step.target);
      }
      return;
    case "moveAway":
      if (
        world.hasDirectory(folder) &&
        !world.hasDirectory(parked(step.target)) &&
        (moveAncestors || !isAncestorOfAnyRoot(step.target, roots))
      ) {
        world.createDirectory(parkingLot);
        world.moveTree(folder, parked(step.target));
      }
      return;
    case "moveBack":
      if (
        world.hasDirectory(parked(step.target)) &&
        !world.hasDirectory(folder) &&
        world.hasDirectory(path.dirname(folder))
      ) {
        world.moveTree(parked(step.target), folder);
      }
      return;
    case "watchFails":
      if (failWatched || isAncestorOfEveryRoot(step.target, roots)) {
        world.failNextWatch(folder);
      }
      return;
    case "watchErrors":
      if (isAncestorOfEveryRoot(step.target, roots)) {
        world.failWatchers(folder);
      }
  }
}

function watchedFolders(world: FolderWorld, roots: string[]): string[] {
  const excluded = new Set(["node_modules", ".git"]);
  return roots.flatMap((root) =>
    world.directoriesUnder(root).filter((directory) =>
      path
        .relative(root, directory)
        .split(path.sep)
        .every((part) => !excluded.has(part)),
    ),
  );
}

function nearestExistingAncestor(world: FolderWorld, folder: string): string {
  const parent = path.dirname(folder);
  return parent === folder || world.hasDirectory(parent)
    ? parent
    : nearestExistingAncestor(world, parent);
}

/**
 * The directories that must hold an open watcher once the file system
 * settles: each existing watched folder once, and the nearest existing
 * ancestor of each scanned root that is missing.
 */
export function expectedWatchers(
  world: FolderWorld,
  roots: string[],
): string[] {
  const missing = roots.filter((root) => !world.hasDirectory(root));
  return [
    ...watchedFolders(world, roots),
    ...missing.map((root) => nearestExistingAncestor(world, root)),
  ].sort();
}

async function flush(world: FolderWorld): Promise<void> {
  do {
    await new Promise<void>((resolve) => setImmediate(resolve));
  } while (!world.isQuiet());
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function settle(
  world: FolderWorld,
  clock: sinon.SinonFakeTimers,
): Promise<void> {
  let previous = "";
  for (let round = 0; round < 30; round++) {
    await flush(world);
    await clock.tickAsync(WATCH_RETRY_DELAY_MS);
    await flush(world);
    const state = `${world.activity()}|${world.openWatcherDirectories().join(",")}`;
    if (world.isQuiet() && state === previous) {
      return;
    }
    previous = state;
  }
  assert.fail("the watcher never settled");
}

function describeState(
  world: FolderWorld,
  roots: string[],
  steps: Operation[],
): string {
  return [
    `operations: ${JSON.stringify(steps)}`,
    `open watchers: ${JSON.stringify(world.openWatcherDirectories())}`,
    `expected:      ${JSON.stringify(expectedWatchers(world, roots))}`,
  ].join("\n");
}

/**
 * Drives a real `FileWatcher` over the scenario's file system and checks
 * the settled state: one open watcher per existing watched folder, none for
 * a deleted one, an ancestor watcher per missing scanned root, an edit in
 * each watched folder reaching the module, and no watcher left after
 * `stopWatching`.
 */
export async function runScenario(run: Scenario): Promise<void> {
  const world = new FolderWorld();
  const clock = sinon.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const restoreWatch = world.installWatch();
  const { warn, error } = console;
  console.warn = () => {};
  console.error = () => {};
  const watcher = new FileWatcher(world);
  const roots = run.watchDirs.map((dir) => path.join(folders.mod, dir));
  const moveAncestors = run.moveAncestors === true;
  const failWatched = run.failWatched === true;
  const changed: string[] = [];
  watcher.onModuleChanged((moduleId) => changed.push(moduleId));
  try {
    populate(world, "project");
    const startAfter = Math.min(run.startAfter, run.operations.length);
    for (const step of run.operations.slice(0, startAfter)) {
      apply(world, { operation: step, roots, moveAncestors, failWatched });
    }
    await watcher.scanModule("mod", folders.mod, [...run.watchDirs]);
    watcher.startWatching();
    for (const step of run.operations.slice(startAfter)) {
      apply(world, { operation: step, roots, moveAncestors, failWatched });
      if (step.kind === "tick") {
        await clock.tickAsync(WATCH_RETRY_DELAY_MS);
      }
      if (run.overlap !== true) {
        await flush(world);
      }
    }
    await settle(world, clock);
    const state = describeState(world, roots, run.operations);
    assert.deepEqual(
      world.openWatcherDirectories(),
      expectedWatchers(world, roots),
      `open watchers differ from the watched folders\n${state}`,
    );
    for (const folder of watchedFolders(world, roots)) {
      const seen = changed.length;
      await world.writeFile(path.join(folder, "f.txt"), `edit ${seen}`);
      await settle(world, clock);
      assert.ok(
        changed.length > seen && changed.at(-1) === "mod",
        `an edit in ${folder} did not reach its module\n${state}`,
      );
    }
    watcher.stopWatching();
    await settle(world, clock);
    assert.deepEqual(
      world.openWatcherDirectories(),
      [],
      `a watcher stayed open after stopWatching\n${state}`,
    );
  } finally {
    watcher.stopWatching();
    restoreWatch();
    clock.restore();
    console.warn = warn;
    console.error = error;
  }
}

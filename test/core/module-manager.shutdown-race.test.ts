import { internal } from "@antelopejs/interface-core/internal";
import { expect } from "chai";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import NodeModule from "node:module";
import path from "node:path";

import { Module, ModuleManager } from "../../src/core/modules";
import { ModuleState } from "../../src/types";
import {
  clearRequireCacheWithin,
  createLocalManifest,
} from "./module-manager.fixtures";

const PROBE = "__ajsShutdownRaceProbe";

interface Gate {
  entered: Promise<void>;
  enter: () => void;
  released: Promise<void>;
  release: () => void;
}

interface Probe {
  events: string[];
  provide: Gate;
  destroy: Gate;
}

function createGate(): Gate {
  let enter = (): void => undefined;
  let release = (): void => undefined;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { entered, enter, released, release };
}

function installProbe(): Probe {
  const probe = { events: [], provide: createGate(), destroy: createGate() };
  Reflect.set(globalThis, PROBE, probe);
  return probe;
}

function recorder(
  name: string,
  hooks: { provide?: boolean; slowDestroy?: boolean } = {},
): string {
  const lines = [
    `const probe = globalThis.${PROBE};`,
    `exports.construct = async () => { probe.events.push("${name}:construct"); };`,
    `exports.destroy = async () => {`,
    hooks.slowDestroy
      ? `  probe.destroy.enter(); await probe.destroy.released;`
      : "",
    `  probe.events.push("${name}:destroy");`,
    `};`,
  ];
  if (hooks.provide) {
    lines.push(
      `exports.provide = () => new Promise((resolve) => {`,
      `  probe.provide.released.then(() => resolve({ port: 3000 }));`,
      `  probe.provide.enter();`,
      `});`,
    );
  }
  return lines.join("\n");
}

async function writeModule(
  folder: string,
  source: string,
  configVars: string[] = [],
): Promise<string> {
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name: path.basename(folder),
      version: "1.0.0",
      main: "index.js",
      antelopeJs: { configVars },
    }),
  );
  await writeFile(path.join(folder, "index.js"), source);
  return folder;
}

async function addFolders(
  manager: ModuleManager,
  folders: string[],
): Promise<ReturnType<ModuleManager["addModules"]>> {
  return manager.addModules(
    await Promise.all(
      folders.map(async (folder) => ({
        manifest: await createLocalManifest(folder),
      })),
    ),
  );
}

async function shutDown(manager: ModuleManager): Promise<void> {
  await manager.stopAll();
  await manager.destroyAll();
}

function unmatchedConstructs(events: string[]): string[] {
  return events
    .filter((event) => event.endsWith(":construct"))
    .map((event) => event.replace(":construct", ""))
    .filter((name) => !events.includes(`${name}:destroy`));
}

describe("ModuleManager shutdown during an async provide", () => {
  let root: string;

  beforeEach(async () => {
    internal.moduleByFolder.splice(0, internal.moduleByFolder.length);
    root = await mkdtemp(path.join(tmpdir(), "ajs-shutdown-race-"));
  });

  afterEach(async () => {
    Reflect.deleteProperty(globalThis, PROBE);
    clearRequireCacheWithin(root);
    await rm(root, { recursive: true, force: true });
  });

  it("constructs no module once a shutdown began while a provide was pending", async () => {
    const probe = installProbe();
    const provider = await writeModule(
      path.join(root, "provider"),
      recorder("provider", { provide: true }),
      ["port"],
    );
    const consumer = await writeModule(
      path.join(root, "consumer"),
      recorder("consumer"),
    );
    const manager = new ModuleManager();
    const entries = await addFolders(manager, [provider, consumer]);

    const construction = manager.constructAll();
    await probe.provide.entered;
    const shutdown = shutDown(manager);
    probe.provide.release();
    await construction;
    await shutdown;

    expect(probe.events).to.deep.equal([]);
    expect(entries.map(({ module }) => module.state)).to.deep.equal([
      ModuleState.Loaded,
      ModuleState.Loaded,
    ]);
  });

  it("does not construct a reload replacement once a shutdown began", async () => {
    const probe = installProbe();
    const steady = await writeModule(
      path.join(root, "steady"),
      recorder("steady", { slowDestroy: true }),
    );
    const watched = await writeModule(
      path.join(root, "watched"),
      recorder("watched"),
    );
    const next = await writeModule(
      path.join(root, "next", "watched"),
      recorder("next", { provide: true }),
      ["port"],
    );
    const manager = new ModuleManager();
    const [, previous] = await addFolders(manager, [steady, watched]);
    await manager.constructAll();
    await manager.startAll();
    await previous.module.destroy();
    const replacement = new Module(await createLocalManifest(next));
    manager.replaceLoadedModule(replacement.id, replacement);

    const construction = manager.constructModules([
      { module: replacement, config: previous.config },
    ]);
    await probe.provide.entered;
    const shutdown = shutDown(manager);
    probe.provide.release();
    await probe.destroy.entered;
    await construction;
    probe.destroy.release();
    await shutdown;

    expect(probe.events).to.not.include("next:construct");
    expect(replacement.state).to.equal(ModuleState.Loaded);
  });

  it("destroys every module a provide resolving with the shutdown constructs", async () => {
    const probe = installProbe();
    const other = await writeModule(
      path.join(root, "other"),
      recorder("other"),
    );
    const slow = await writeModule(
      path.join(root, "slow"),
      recorder("slow", { provide: true }),
      ["port"],
    );
    const manager = new ModuleManager();
    await addFolders(manager, [slow, other]);

    const construction = manager.constructAll();
    await probe.provide.entered;
    probe.provide.release();
    const shutdown = shutDown(manager);
    await construction;
    await shutdown;

    expect(unmatchedConstructs(probe.events)).to.deep.equal([]);
  });

  it("takes no resolver lease when asked to construct after destroyAll", async () => {
    installProbe();
    const late = await writeModule(path.join(root, "late"), recorder("late"));
    const manager = new ModuleManager();
    await manager.destroyAll();
    const original = NodeModule._resolveFilename;
    const entries = await addFolders(manager, [late]);

    await manager.constructModules(entries);

    expect(NodeModule._resolveFilename).to.equal(original);
    expect(entries[0].module.state).to.equal(ModuleState.Loaded);
  });
});

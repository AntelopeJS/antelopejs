import { expect } from "chai";
import sinon from "sinon";

import { commandsProjectModulesLocksModule as moduleLocks } from "../../../../../src/cli";
import {
  DownloaderRegistry,
  registerPackageDownloader,
} from "../../../../../src/core/downloaders";
import { ModuleCache, ModuleLockStore } from "../../../../../src/core/modules";
import { getProcessUi } from "../../../../../src/core/output";
import { fakeNpm } from "../../../../helpers/fake-npm";
import { InMemoryFileSystem } from "../../../../helpers/in-memory-filesystem";

const PROJECT = "/project";

function packageModule(name: string, version: string) {
  return {
    id: name,
    source: { type: "package", package: name, version } as const,
  };
}

async function createRefreshContext(fs: InMemoryFileSystem) {
  const cache = new ModuleCache("/cache", fs);
  await cache.load();
  const store = new ModuleLockStore(PROJECT, fs);
  const registry = new DownloaderRegistry();
  registerPackageDownloader(registry, {
    fs,
    ...fakeNpm(fs, (name, version) => `resolved ${name}@${version} today`),
    lock: { store, mode: "refresh" },
  });
  return { project: PROJECT, cache, registry, store };
}

describe("project modules behavior: refreshModuleLocks", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("records the lock each module resolves to and reports the added and changed ones", async () => {
    const message = sinon.stub(getProcessUi(), "message");
    const fs = new InMemoryFileSystem();
    const context = await createRefreshContext(fs);
    await context.store.write({
      package: "kept",
      version: "1.0.0",
      lockfile: "pnpm-lock.yaml",
      content: "resolved kept@1.0.0 today",
    });
    await context.store.write({
      package: "moved",
      version: "2.0.0",
      lockfile: "pnpm-lock.yaml",
      content: "resolved moved@2.0.0 last year",
    });

    const refreshed = await moduleLocks.refreshModuleLocks(
      PROJECT,
      { name: "proj" },
      [
        packageModule("kept", "1.0.0"),
        packageModule("moved", "2.0.0"),
        packageModule("fresh", "3.0.0"),
      ],
      context,
    );

    expect(
      refreshed.map(({ key, change }) => [key.package, change]),
    ).to.deep.equal([
      ["kept", "unchanged"],
      ["moved", "changed"],
      ["fresh", "added"],
    ]);
    expect(
      await fs.readFileString(
        `${PROJECT}/antelope-lock/moved@2.0.0/pnpm-lock.yaml`,
      ),
    ).to.equal("resolved moved@2.0.0 today");
    expect(
      await fs.readFileString(
        `${PROJECT}/antelope-lock/fresh@3.0.0/pnpm-lock.yaml`,
      ),
    ).to.equal("resolved fresh@3.0.0 today");
    const reported = message.args
      .map(([, text]) => text)
      .filter((text) => text.includes("antelope-lock"));
    expect(reported).to.have.length(2);
    expect(
      reported.filter((text) => text.includes("kept@1.0.0")),
    ).to.deep.equal([]);
    expect(
      reported.filter((text) => text.includes("moved@2.0.0")),
    ).to.have.length(1);
    expect(
      reported.filter((text) => text.includes("moved@2.0.0"))[0],
    ).to.include("changed");
    expect(
      reported.filter((text) => text.includes("fresh@3.0.0"))[0],
    ).to.include("added");
  });
});

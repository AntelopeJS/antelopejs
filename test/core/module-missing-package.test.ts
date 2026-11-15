import { expect } from "chai";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { MissingPackageError, Module } from "../../src/core/modules";
import { manifestFixture } from "../helpers/module-fixtures";
import { cleanupTempDir, makeTempDir } from "../helpers/temp";

let folder: string;
let moduleFolder: string;

function useModuleFolder(): void {
  beforeEach(() => {
    folder = makeTempDir("ajs-missing-package-");
    moduleFolder = path.join(folder, "missing-consumer");
    mkdirSync(moduleFolder);
  });

  afterEach(() => {
    cleanupTempDir(folder);
  });
}

function installPackage(name: string): void {
  const root = path.join(moduleFolder, "node_modules", name);
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name }));
  writeFileSync(path.join(root, "index.js"), "");
}

function moduleRunning(
  source: string,
  dependencies: Record<string, string>,
): Module {
  const main = path.join(moduleFolder, "index.js");
  writeFileSync(main, source);
  return new Module(
    manifestFixture({
      name: "missing-consumer",
      version: "1.0.0",
      folder: moduleFolder,
      main,
      manifest: { name: "missing-consumer", dependencies },
    }),
  );
}

function moduleRequiring(
  request: string,
  dependencies: Record<string, string>,
): Module {
  return moduleRunning(`require(${JSON.stringify(request)});`, dependencies);
}

describe("Module load of a declared package that is not installed", () => {
  useModuleFolder();

  it("names the module, the package and the install command when a declared dependency is not installed", async () => {
    const mod = moduleRequiring("ajs-missing-interface", {
      "ajs-missing-interface": "^1.0.0",
    });

    const failure = await mod.construct({}).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).to.be.instanceOf(MissingPackageError);
    expect(String(failure)).to.contain(
      "missing-consumer requires ajs-missing-interface, which is not installed. Install the dependencies of missing-consumer, then run 'ajs project modules install'",
    );
  });

  it("names a scoped package", async () => {
    const mod = moduleRequiring("@ajs-missing/interface", {
      "@ajs-missing/interface": "^1.0.0",
    });

    const failure = await mod.construct({}).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).to.be.instanceOf(MissingPackageError);
    expect(failure).to.include({ packageName: "@ajs-missing/interface" });
  });

  it("names a package whose node_modules folder holds no package.json", async () => {
    mkdirSync(path.join(moduleFolder, "node_modules", "ajs-leftover"), {
      recursive: true,
    });
    const mod = moduleRequiring("ajs-leftover", { "ajs-leftover": "^1.0.0" });

    const failure = await mod.construct({}).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).to.include({ packageName: "ajs-leftover" });
  });

  it("names a package installed only above the link of a symlinked module", async () => {
    const realFolder = path.join(folder, "outside", "linked-consumer");
    mkdirSync(realFolder, { recursive: true });
    const linkParent = path.join(folder, "project");
    mkdirSync(path.join(linkParent, "node_modules", "ajs-root-lib"), {
      recursive: true,
    });
    writeFileSync(
      path.join(linkParent, "node_modules", "ajs-root-lib", "package.json"),
      JSON.stringify({ name: "ajs-root-lib" }),
    );
    const linkedFolder = path.join(linkParent, "linked-consumer");
    symlinkSync(realFolder, linkedFolder, "dir");
    writeFileSync(
      path.join(realFolder, "index.js"),
      'require("ajs-root-lib");',
    );
    const mod = new Module(
      manifestFixture({
        name: "linked-consumer",
        version: "1.0.0",
        folder: linkedFolder,
        main: path.join(linkedFolder, "index.js"),
        manifest: {
          name: "linked-consumer",
          dependencies: { "ajs-root-lib": "^1.0.0" },
        },
      }),
    );

    const failure = await mod.construct({}).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).to.include({ packageName: "ajs-root-lib" });
  });
});

describe("Module load failures that keep Node's error", () => {
  useModuleFolder();

  it("keeps Node's error for a subpath of a package that is not installed", async () => {
    const mod = moduleRequiring("ajs-missing-interface/sub", {
      "ajs-missing-interface": "^1.0.0",
    });

    const failure = await mod.construct({}).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).not.to.be.instanceOf(MissingPackageError);
    expect(String(failure)).to.contain(
      "Cannot find module 'ajs-missing-interface/sub'",
    );
  });

  it("keeps Node's error for a missing package the module does not declare", async () => {
    const mod = moduleRequiring("ajs-undeclared-package", {});

    const failure = await mod.construct({}).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).not.to.be.instanceOf(MissingPackageError);
    expect(String(failure)).to.contain(
      "Cannot find module 'ajs-undeclared-package'",
    );
  });

  it("keeps Node's error for a missing file inside an installed package", async () => {
    installPackage("ajs-util-lib");
    const mod = moduleRequiring("ajs-util-lib/lib/helpers", {
      "ajs-util-lib": "^1.0.0",
    });

    const failure = await mod.construct({}).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).not.to.be.instanceOf(MissingPackageError);
    expect(String(failure)).to.contain(
      "Cannot find module 'ajs-util-lib/lib/helpers'",
    );
  });

  it("keeps Node's error when a dependency cannot reach a package the module installed", async () => {
    installPackage("ajs-shared-lib");
    const store = path.join(folder, "store");
    mkdirSync(store);
    writeFileSync(
      path.join(store, "dependency.js"),
      'require("ajs-shared-lib");',
    );
    const mod = moduleRunning(
      `require("ajs-shared-lib"); require(${JSON.stringify(path.join(store, "dependency.js"))});`,
      { "ajs-shared-lib": "^1.0.0" },
    );

    const failure = await mod.construct({}).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).not.to.be.instanceOf(MissingPackageError);
    expect(String(failure)).to.contain("Cannot find module 'ajs-shared-lib'");
  });
});

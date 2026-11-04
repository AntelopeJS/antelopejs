import { expect } from "chai";
import fs from "node:fs";
import path from "node:path";

import { createRuntime } from "../../src";
import type { JsonValue } from "../helpers/json";
import { cleanupTempDir, makeTempDir } from "../helpers/temp";

const STARTED_MARKER = "started";

const MODULE_SOURCE = (marker: string) =>
  `module.exports = { construct() {}, start() { require("node:fs").writeFileSync(${JSON.stringify(marker)}, "yes"); }, stop() {}, destroy() {} };`;

function writePackage(
  folder: string,
  manifest: JsonValue,
  source: string,
): void {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "package.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(folder, "index.js"), source);
}

async function startAndStop(
  root: string,
  modules: NonNullable<Parameters<typeof createRuntime>[0]>["modules"],
): Promise<string | undefined> {
  const runtime = createRuntime({ projectFolder: root, modules });
  try {
    await runtime.start();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    await runtime.stop().catch(() => undefined);
  }
}

describe("package.json fields of the wrong type, through the real runtime", () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(makeTempDir("ajs-non-string-fields-"));
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "host", version: "1.0.0" }),
    );
  });

  afterEach(() => {
    cleanupTempDir(root);
  });

  for (const version of [1, 1.5, true, ["1.0.0"]]) {
    it(`starts an embedded module whose version is ${JSON.stringify(version)}`, async () => {
      writePackage(
        path.join(root, "node_modules", "numver"),
        { name: "numver", version, main: "index.js" },
        MODULE_SOURCE(path.join(root, STARTED_MARKER)),
      );

      const failure = await startAndStop(root, { numver: {} });

      expect(failure).to.equal(undefined);
      expect(fs.existsSync(path.join(root, STARTED_MARKER))).to.equal(true);
    });
  }

  for (const version of [0, "", false, null]) {
    it(`still refuses an embedded module whose version is ${JSON.stringify(version)}`, async () => {
      writePackage(
        path.join(root, "node_modules", "numver"),
        { name: "numver", version, main: "index.js" },
        MODULE_SOURCE(path.join(root, STARTED_MARKER)),
      );

      const failure = await startAndStop(root, { numver: {} });

      expect(failure).to.contain("could not be resolved");
    });
  }

  function installConsumer(interfaceManifest: JsonValue): void {
    const consumer = path.join(root, "node_modules", "consumer");
    writePackage(
      consumer,
      {
        name: "consumer",
        version: "1.0.0",
        main: "index.js",
        dependencies: { ifc: "*" },
      },
      MODULE_SOURCE(path.join(root, STARTED_MARKER)),
    );
    writePackage(
      path.join(consumer, "node_modules", "ifc"),
      interfaceManifest,
      "module.exports = {};",
    );
  }

  const blockedInterfaces: Array<[string, JsonValue]> = [
    [
      "an interface with a string version",
      { name: "ifc", version: "1.0.0", main: "index.js", antelopeJs: {} },
    ],
    [
      "an interface with a numeric version",
      { name: "ifc", version: 1, main: "index.js", antelopeJs: {} },
    ],
    [
      "an interface whose antelopeJs is a string",
      { name: "ifc", version: "1.0.0", main: "index.js", antelopeJs: "x" },
    ],
    [
      "an interface whose antelopeJs is an array",
      { name: "ifc", version: "1.0.0", main: "index.js", antelopeJs: [] },
    ],
    [
      "an interface whose antelopeJs is true",
      { name: "ifc", version: "1.0.0", main: "index.js", antelopeJs: true },
    ],
  ];

  for (const [label, manifest] of blockedInterfaces) {
    it(`blocks a module that depends on ${label} with no provider`, async () => {
      installConsumer(manifest);

      const failure = await startAndStop(root, { consumer: {} });

      expect(failure).to.contain("Unresolved interface dependencies");
      expect(fs.existsSync(path.join(root, STARTED_MARKER))).to.equal(false);
    });
  }

  it("keeps failing for a standalone interface with a numeric version", async () => {
    installConsumer({
      name: "ifc",
      version: 1,
      main: "index.js",
      antelopeJs: { standalone: true },
    });

    const failure = await startAndStop(root, { consumer: {} });

    expect(failure).to.be.a("string");
    expect(fs.existsSync(path.join(root, STARTED_MARKER))).to.equal(false);
  });

  it("starts a module that depends on a standalone interface with a string version", async () => {
    installConsumer({
      name: "ifc",
      version: "1.0.0",
      main: "index.js",
      antelopeJs: { standalone: true },
    });

    const failure = await startAndStop(root, { consumer: {} });

    expect(failure).to.equal(undefined);
  });

  it("starts a module that depends on a plain library with a numeric version", async () => {
    installConsumer({ name: "ifc", version: 1, main: "index.js" });

    const failure = await startAndStop(root, { consumer: {} });

    expect(failure).to.equal(undefined);
  });
});

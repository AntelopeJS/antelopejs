import { expect } from "chai";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { TestModule } from "../../src";
import {
  cleanupTempDir,
  listDirectory,
  makeTempDir,
  readText,
  writeJson,
} from "../helpers/temp";

const CORE = "@antelopejs/interface-core";
const EXTRA_SOURCE = '{ type: "local", path: "./extra" }';
const FIXTURE_TEST = "describe('fixture', () => { it('runs', () => {}); });\n";

/** Writes a module at `folder` whose `construct` records its config as `<label>.json` under `constructed`. */
function writeRecordingModule(root: string, folder: string, label: string) {
  writeJson(path.join(folder, "package.json"), {
    name: label,
    version: "1.0.0",
    main: "index.js",
  });
  const record = path.join(root, "constructed", `${label}.json`);
  writeFileSync(
    path.join(folder, "index.js"),
    `exports.construct = (config) => { require("node:fs").writeFileSync(${JSON.stringify(record)}, JSON.stringify({ config })); };\n`,
  );
}

/**
 * Writes a module whose `antelope.test.config.ts` declares the module itself
 * as `self`, with `{ greeting: "base", kept: "base" }` as its config, and
 * whose `test.setup` returns the TypeScript expression `overrides`. A local
 * module waits in `extra`, and the cache holds the packages `greeter@1.0.0`
 * and `self@1.0.0`. `test.cleanup` writes the file `cleanup-ran`.
 */
function writeFixture(folder: string, overrides: string): void {
  mkdirSync(path.join(folder, "constructed"));
  writeRecordingModule(folder, folder, "self");
  writeJson(path.join(folder, "package.json"), {
    name: "self",
    version: "1.0.0",
    main: "index.js",
    antelopeJs: { test: "antelope.test.config.ts" },
  });
  writeRecordingModule(folder, path.join(folder, "extra"), "extra");
  const cache = path.join(folder, ".cache");
  writeRecordingModule(folder, path.join(cache, "greeter@1.0.0"), "greeter");
  writeRecordingModule(folder, path.join(cache, "self@1.0.0"), "self-package");
  writeJson(path.join(cache, "manifest.json"), {
    "greeter@1.0.0": "1.0.0",
    "self@1.0.0": "1.0.0",
  });
  writeFileSync(path.join(folder, "fixture.test.js"), FIXTURE_TEST);
  writeFileSync(
    path.join(folder, "antelope.test.config.ts"),
    [
      'import { writeFileSync } from "node:fs";',
      "export default {",
      '  name: "setup-overrides",',
      '  cacheFolder: ".cache",',
      "  modules: {",
      "    self: {",
      '      source: { type: "local", path: "." },',
      '      config: { greeting: "base", kept: "base" },',
      "    },",
      "  },",
      "  test: {",
      `    setup: async () => (${overrides}),`,
      `    cleanup: async () => { writeFileSync(${JSON.stringify(path.join(folder, "cleanup-ran"))}, ""); },`,
      "  },",
      "};",
      "",
    ].join("\n"),
  );
}

async function withFixture(
  overrides: string,
  use: (folder: string) => Promise<void>,
): Promise<void> {
  const folder = makeTempDir("ajs-setup-overrides-");
  try {
    writeFixture(folder, overrides);
    await use(folder);
  } finally {
    cleanupTempDir(folder);
  }
}

function runTests(folder: string): Promise<number> {
  return TestModule(folder, [path.join(folder, "fixture.test.js")]);
}

/** The config each constructed module received, keyed by module label. */
function constructedConfigs(folder: string) {
  const records = path.join(folder, "constructed");
  return Object.fromEntries(
    listDirectory(records).map((file): [string, unknown] => {
      const recorded: unknown = JSON.parse(readText(path.join(records, file)));
      return [path.basename(file, ".json"), recorded];
    }),
  );
}

const BASE_CONFIG = { config: { greeting: "base", kept: "base" } };

const REFUSED_OVERRIDES = [
  { label: "a null name", overrides: "{ name: null }", field: "name" },
  {
    label: "a numeric cacheFolder",
    overrides: "{ cacheFolder: 42 }",
    field: "cacheFolder",
  },
  {
    label: "a null modules map",
    overrides: "{ modules: null }",
    field: "modules",
  },
  {
    label: "importOverrides written as a string",
    overrides: `{ modules: { self: { importOverrides: "${CORE}" } } }`,
    field: "modules.self.importOverrides",
  },
  {
    label: "a replaced test.setup",
    overrides: "{ test: { setup: async () => undefined } }",
    field: "test.setup",
  },
  {
    label: "a replaced test.cleanup",
    overrides: "{ test: { cleanup: async () => undefined } }",
    field: "test.cleanup",
  },
];

describe("TestModule setup overrides", () => {
  it("merges an override into the declared module config before the module constructs", async () => {
    await withFixture(
      '{ modules: { self: { config: { greeting: "hi" } } } }',
      async (folder) => {
        expect(await runTests(folder)).to.equal(0);
        expect(constructedConfigs(folder)).to.deep.equal({
          self: { config: { greeting: "hi", kept: "base" } },
        });
      },
    );
  });

  it("constructs an added module that gives only a source, with the loader's empty config", async () => {
    await withFixture(
      `{ modules: { extra: { source: ${EXTRA_SOURCE} } } }`,
      async (folder) => {
        expect(await runTests(folder)).to.equal(0);
        expect(constructedConfigs(folder)).to.deep.equal({
          self: BASE_CONFIG,
          extra: { config: {} },
        });
      },
    );
  });

  it("expands an added version string into the package of that name", async () => {
    await withFixture('{ modules: { greeter: "1.0.0" } }', async (folder) => {
      expect(await runTests(folder)).to.equal(0);
      expect(constructedConfigs(folder)).to.deep.equal({
        self: BASE_CONFIG,
        greeter: { config: {} },
      });
    });
  });

  it("replaces a loaded entry that an override writes as a version string", async () => {
    await withFixture('{ modules: { self: "1.0.0" } }', async (folder) => {
      expect(await runTests(folder)).to.equal(0);
      expect(constructedConfigs(folder)).to.deep.equal({
        "self-package": { config: {} },
      });
    });
  });

  for (const { label, overrides, module } of [
    {
      label: "a loaded entry",
      overrides: `{ modules: { self: { importOverrides: { "${CORE}": "missing" } } } }`,
      module: "self",
    },
    {
      label: "an added entry",
      overrides: `{ modules: { extra: { source: ${EXTRA_SOURCE}, importOverrides: { "${CORE}": "missing" } } } }`,
      module: "extra",
    },
  ]) {
    it(`routes record-form importOverrides on ${label} as the list form routes them`, async () => {
      await withFixture(overrides, async (folder) => {
        await assert.rejects(runTests(folder), {
          message: `Module '${module}' routes '${CORE}' to 'missing', but that loaded module does not provide the interface.`,
        });
      });
    });
  }

  it("keeps the loaded value of every field an override writes as undefined", async () => {
    await withFixture(
      "{ name: undefined, cacheFolder: undefined, test: { setup: undefined }, modules: { self: { source: undefined, importOverrides: undefined, disabledExports: undefined } } }",
      async (folder) => {
        expect(await runTests(folder)).to.equal(0);
        expect(constructedConfigs(folder)).to.deep.equal({ self: BASE_CONFIG });
      },
    );
  });

  it("passes a module config written as undefined to the module", async () => {
    await withFixture(
      "{ modules: { self: { config: undefined } } }",
      async (folder) => {
        expect(await runTests(folder)).to.equal(0);
        expect(constructedConfigs(folder)).to.deep.equal({ self: {} });
      },
    );
  });

  it("leaves out the loaded and added modules an override disables", async () => {
    await withFixture(
      `{ modules: { self: { disabled: true }, extra: { source: ${EXTRA_SOURCE}, disabled: true } } }`,
      async (folder) => {
        expect(await runTests(folder)).to.equal(0);
        expect(constructedConfigs(folder)).to.deep.equal({});
      },
    );
  });
});

describe("TestModule refused setup overrides", () => {
  it("runs the configuration's own cleanup after refusing an override", async () => {
    await withFixture(
      "{ test: { cleanup: async () => undefined } }",
      async (folder) => {
        await assert.rejects(runTests(folder), {
          message:
            "Configuration field 'test.cleanup' does not hold the cleanup function the configuration file gave after the test setup overrides.",
        });
        expect(listDirectory(folder)).to.include("cleanup-ran");
      },
    );
  });

  for (const { label, overrides, field } of REFUSED_OVERRIDES) {
    it(`refuses ${label}, naming the field`, async () => {
      await withFixture(overrides, async (folder) => {
        await assert.rejects(runTests(folder), (error) => {
          assert.ok(error instanceof Error);
          const { message } = error;
          assert.ok(
            message.startsWith(`Configuration field '${field}' does not hold `),
            message,
          );
          assert.ok(
            message.endsWith(" after the test setup overrides."),
            message,
          );
          return true;
        });
        expect(constructedConfigs(folder)).to.deep.equal({});
      });
    });
  }
});

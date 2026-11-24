import type { AntelopeConfig } from "@antelopejs/interface-core/config";
import fc from "fast-check";
import assert from "node:assert/strict";
import path from "node:path";

import { writeConfig, writeModuleManifest } from "../../../src/cli";
import { oxfmt } from "../../helpers/oxfmt";
import { cleanupTempDir, makeTempDir, readText } from "../../helpers/temp";

const moduleEntry = fc.oneof(
  fc.constant("^1.0.0"),
  fc.record({
    source: fc.record({
      type: fc.constant("package" as const),
      package: fc.constantFrom("api", "web", "@scope/storage"),
      version: fc.constantFrom("1.0.0", "^2.1.0"),
    }),
  }),
  fc.record({
    source: fc.record({
      type: fc.constant("local" as const),
      path: fc.constantFrom("./web", "../api"),
    }),
    config: fc.record(
      { port: fc.nat(9999), tags: fc.array(fc.constantFrom("a", "b")) },
      { requiredKeys: [] },
    ),
  }),
);

const moduleMap = fc.dictionary(
  fc.constantFrom("api", "web", "storage", "my-module"),
  moduleEntry,
  { maxKeys: 3 },
);

const manifest = fc.record(
  {
    name: fc.constantFrom("shop", "@scope/shop"),
    version: fc.constant("1.0.0"),
    author: fc.oneof(fc.constant("me"), fc.array(fc.constantFrom("a", "b"))),
    dependencies: fc.dictionary(
      fc.constantFrom("x", "y", "@s/a", "a-b", "a.b", "B"),
      fc.constant("^1.0.0"),
    ),
    antelopeJs: fc.record(
      {
        implements: fc.array(fc.constantFrom("core@1", "logging@1")),
        paths: fc.dictionary(
          fc.constantFrom("@a/*", "b"),
          fc.array(fc.constantFrom("./src/*", "./lib")),
        ),
      },
      { requiredKeys: [] },
    ),
  },
  { requiredKeys: ["name"] },
);

describe("CLI writers emit what oxfmt keeps", () => {
  it("writeConfig output is an oxfmt fixpoint after one to three writes", async function () {
    this.timeout(60000);
    await fc.assert(
      fc.asyncProperty(
        fc.array(moduleMap, { minLength: 1, maxLength: 3 }),
        async (maps) => {
          const folder = makeTempDir("antelopejs-fixpoint-");
          try {
            for (const modules of maps) {
              const config: Partial<AntelopeConfig> = { name: "shop", modules };
              await writeConfig(folder, config);
              const file = path.join(folder, "antelope.config.ts");
              const written = readText(file);
              assert.equal(written, oxfmt(written, file));
            }
          } finally {
            cleanupTempDir(folder);
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it("writeModuleManifest output is an oxfmt fixpoint", async function () {
    this.timeout(60000);
    await fc.assert(
      fc.asyncProperty(
        fc.array(manifest, { minLength: 1, maxLength: 3 }),
        async (manifests) => {
          const folder = makeTempDir("antelopejs-fixpoint-");
          try {
            for (const data of manifests) {
              await writeModuleManifest(folder, data);
              const file = path.join(folder, "package.json");
              const written = readText(file);
              assert.equal(written, oxfmt(written, file));
            }
          } finally {
            cleanupTempDir(folder);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

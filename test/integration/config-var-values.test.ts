import { expect } from "chai";
import fs from "node:fs/promises";
import path from "node:path";

import launch from "../../src";
import { cleanupTempDir, makeTempDir, writeJson } from "../helpers/temp";

const NONPRIMITIVE_VALUES = [
  ["an object", "{ enabled: true }"],
  ["an array", "[5010]"],
  ["a function", "() => 5010"],
  ["null", "null"],
  ["undefined", "undefined"],
  ["a bigint", "5010n"],
] as const;

async function createProject(publishedSource: string): Promise<string> {
  const projectFolder = makeTempDir("ajs-config-var-values-");
  writeJson(path.join(projectFolder, "api/package.json"), {
    name: "api",
    version: "1.0.0",
    main: "index.js",
    antelopeJs: { configVars: ["PAYLOAD"] },
  });
  await fs.writeFile(
    path.join(projectFolder, "api/index.js"),
    `exports.provide = () => ({ PAYLOAD: ${publishedSource} });\n`,
  );
  writeJson(path.join(projectFolder, "dms/package.json"), {
    name: "dms",
    version: "1.0.0",
    main: "index.js",
  });
  await fs.writeFile(
    path.join(projectFolder, "dms/index.js"),
    "exports.construct = () => undefined;\n",
  );
  const modules = {
    api: { source: { type: "local", path: "./api", main: "index.js" } },
    dms: {
      source: { type: "local", path: "./dms", main: "index.js" },
      config: { payload: "${@api.PAYLOAD}" },
    },
  };
  await fs.writeFile(
    path.join(projectFolder, "antelope.config.ts"),
    `export default ${JSON.stringify({ name: "config-var-values", modules })};\n`,
  );
  return projectFolder;
}

function flattenErrors(error: Error): string[] {
  if (error instanceof AggregateError) {
    return error.errors.flatMap((nested) =>
      nested instanceof Error ? flattenErrors(nested) : [String(nested)],
    );
  }
  return [String(error)];
}

async function launchFailures(projectFolder: string): Promise<string[]> {
  try {
    const manager = await launch(projectFolder);
    await manager.stopAll();
    await manager.destroyAll();
    return [];
  } catch (error) {
    return error instanceof Error ? flattenErrors(error) : [String(error)];
  }
}

describe("a provider that publishes a config variable", () => {
  for (const [kind, source] of NONPRIMITIVE_VALUES) {
    it(`fails the launch when the value is ${kind}`, async () => {
      const projectFolder = await createProject(source);
      try {
        const messages = (await launchFailures(projectFolder)).join("\n");

        expect(messages).to.include(
          "Module 'api' published the config variable(s) 'PAYLOAD' with a value that is not a string, a number, or a boolean.",
        );
        expect(messages).to.include(
          "Module 'dms' did not construct: provider 'api' failed.",
        );
      } finally {
        cleanupTempDir(projectFolder);
      }
    });
  }
});

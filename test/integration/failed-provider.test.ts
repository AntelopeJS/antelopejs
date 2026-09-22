import os from "node:os";
import path from "node:path";
import { expect } from "chai";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";

import launch from "../../src";

const CLI_ENTRY = path.resolve(__dirname, "../../src/core/cli/index.ts");
const SPAWN_TIMEOUT_MS = 90000;

interface ProcessResult {
  code: number | null;
  output: string;
}

/**
 * The shape that used to hang: `api` publishes a config variable `dms` reads,
 * and `dms` serves an interface `dms-api` awaits from its own construct.
 * `dms-api` reads no config variable, so nothing in the variable graph knows
 * it depends on `dms`. When `api` fails, `dms` is skipped and `dms-api` waits
 * on a proxy nobody will ever implement.
 */
async function createFailedProviderProject(leaksHandle: boolean) {
  const projectFolder = await fs.mkdtemp(
    path.join(os.tmpdir(), "ajs-failed-provider-"),
  );
  const write = (file: string, content: string) =>
    fs.writeFile(path.join(projectFolder, file), content);

  for (const folder of ["iface-frontend", "api", "dms", "dms-api"]) {
    await fs.mkdir(path.join(projectFolder, folder), { recursive: true });
  }

  await write(
    "iface-frontend/package.json",
    JSON.stringify({
      name: "iface-frontend",
      version: "1.0.0",
      main: "index.js",
      antelopeJs: {},
    }),
  );
  await write(
    "iface-frontend/index.js",
    `const core = require("@antelopejs/interface-core");
exports.Frontend = { AddFrontendModule: core.InterfaceFunction() };
`,
  );

  await write(
    "api/package.json",
    JSON.stringify({
      name: "api",
      version: "1.0.0",
      main: "index.js",
      antelopeJs: { configVars: ["API_PUBLIC_BASE_URL"] },
    }),
  );
  await write(
    "api/index.js",
    `exports.provide = () => {
  throw new Error("publicBaseUrl is required outside dev");
};
`,
  );

  await write(
    "dms/package.json",
    JSON.stringify({
      name: "dms",
      version: "1.0.0",
      main: "index.js",
      dependencies: { "iface-frontend": "*" },
      antelopeJs: { implements: ["iface-frontend"] },
    }),
  );
  await write(
    "dms/index.js",
    `const core = require("@antelopejs/interface-core");
const iface = require("iface-frontend");
exports.construct = () => {
  core.ImplementInterface(iface.Frontend, {
    AddFrontendModule: async () => undefined,
  });
};
`,
  );

  await write(
    "dms-api/package.json",
    JSON.stringify({
      name: "dms-api",
      version: "1.0.0",
      main: "index.js",
      dependencies: { "iface-frontend": "*" },
    }),
  );
  await write(
    "dms-api/index.js",
    `const iface = require("iface-frontend");
exports.construct = async () => {
  await iface.Frontend.AddFrontendModule("dms-api");
};
`,
  );

  for (const folder of ["dms", "dms-api"]) {
    await fs.mkdir(path.join(projectFolder, folder, "node_modules"), {
      recursive: true,
    });
    await fs.symlink(
      path.join(projectFolder, "iface-frontend"),
      path.join(projectFolder, folder, "node_modules", "iface-frontend"),
    );
  }

  const modules: Record<string, unknown> = {
    api: { source: { type: "local", path: "./api", main: "index.js" } },
    dms: {
      source: { type: "local", path: "./dms", main: "index.js" },
      config: { apiBaseUrl: "${@api.API_PUBLIC_BASE_URL}" },
    },
    "dms-api": {
      source: { type: "local", path: "./dms-api", main: "index.js" },
    },
  };

  if (leaksHandle) {
    await fs.mkdir(path.join(projectFolder, "keepalive"), { recursive: true });
    await write(
      "keepalive/package.json",
      JSON.stringify({ name: "keepalive", version: "1.0.0", main: "index.js" }),
    );
    await write(
      "keepalive/index.js",
      `const net = require("node:net");
exports.construct = () =>
  new Promise((resolve) => {
    net.createServer().listen(0, "127.0.0.1", resolve);
  });
`,
    );
    modules.keepalive = {
      source: { type: "local", path: "./keepalive", main: "index.js" },
    };
  }

  await write(
    "antelope.config.ts",
    `export default ${JSON.stringify({ name: "failed-provider", modules }, null, 2)};\n`,
  );

  return projectFolder;
}

function flattenErrors(error: unknown): unknown[] {
  if (error instanceof AggregateError) {
    return error.errors.flatMap((nested) => flattenErrors(nested));
  }
  return [error];
}

function runCli(projectFolder: string): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "-r",
        "ts-node/register",
        CLI_ENTRY,
        "project",
        "dev",
        "-p",
        projectFolder,
      ],
      {
        cwd: path.resolve(__dirname, "../.."),
        env: { ...process.env, TS_NODE_TRANSPILE_ONLY: "true" },
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`The CLI did not exit:\n${output}`));
    }, SPAWN_TIMEOUT_MS - 5000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

describe("a provider that fails to publish its config variables", () => {
  it("fails the interface consumers of the modules it skipped", async () => {
    const projectFolder = await createFailedProviderProject(false);
    try {
      let thrown: unknown;
      try {
        await launch(projectFolder);
      } catch (error) {
        thrown = error;
      }

      const messages = flattenErrors(thrown).map(String);
      expect(messages.join("\n")).to.include(
        "publicBaseUrl is required outside dev",
      );
      expect(messages.join("\n")).to.include(
        "Module 'dms' did not construct: provider 'api' failed.",
      );
      expect(messages.join("\n")).to.include(
        "Interface 'iface-frontend' has no provider: module 'dms' did not construct",
      );
    } finally {
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });

  it("terminates the process with a failing exit code", async function () {
    this.timeout(SPAWN_TIMEOUT_MS);
    const projectFolder = await createFailedProviderProject(true);
    try {
      const result = await runCli(projectFolder);

      expect(result.code).to.not.equal(0);
      expect(result.output).to.include(
        "Module 'dms' did not construct: provider 'api' failed.",
      );
      expect(result.output).to.include(
        "Interface 'iface-frontend' has no provider: module 'dms' did not construct",
      );
    } finally {
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });
});

import os from "node:os";
import sinon from "sinon";
import path from "node:path";
import { expect } from "chai";
import fs from "node:fs/promises";
import { Logging } from "@antelopejs/interface-core/logging";
import { internal } from "@antelopejs/interface-core/internal";

import launch, { type ModuleManager } from "../../src";

const MARKER_TIMEOUT_MS = 8000;
const MARKER_POLL_MS = 50;
const PROXY_IDENTITY = "registering:foreign-package-ownership.pages";
const OWNER_CONSTRUCT_DELAY_MS = 250;

interface RegisteredEntry {
  module: string;
  owner: string;
}

interface RegisteringProxyState {
  registered: Map<string, RegisteredEntry>;
}

function registeredPages(): Map<string, RegisteredEntry> {
  const state = internal.proxyStates.get(PROXY_IDENTITY)?.value as
    | RegisteringProxyState
    | undefined;
  return state?.registered ?? new Map<string, RegisteredEntry>();
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, MARKER_POLL_MS));
  }
  throw new Error(`Timed out waiting for condition after ${timeoutMs}ms`);
}

async function readMarker(markerPath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(markerPath, "utf-8");
  } catch {
    return undefined;
  }
}

function ownerPagesSource(): string {
  return `const { RegisteringProxy } = require("@antelopejs/interface-core");
new RegisteringProxy("foreign-package-ownership.pages").register("owner-page");
exports.pageName = "owner-page";
`;
}

function ownerSource(): string {
  return `exports.construct = async () => {
  await new Promise((resolve) => setTimeout(resolve, ${OWNER_CONSTRUCT_DELAY_MS}));
  require("./pages");
};
exports.start = () => {};
exports.stop = () => {};
exports.destroy = () => {};
`;
}

function consumerSource(version: string): string {
  return `const fs = require("node:fs");
const { pageName } = require("owner/pages");
let cfg;
exports.construct = (c) => { cfg = c; };
exports.start = () => { fs.writeFileSync(cfg.markerPath, "${version}:" + pageName); };
exports.stop = () => {};
exports.destroy = () => {};
`;
}

async function writeModule(
  folder: string,
  name: string,
  source: string,
): Promise<void> {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
  );
  await fs.writeFile(path.join(folder, "index.js"), source);
}

async function createProject(): Promise<string> {
  const projectFolder = await fs.mkdtemp(
    path.join(os.tmpdir(), "ajs-foreign-pkg-"),
  );
  const ownerFolder = path.join(projectFolder, "owner");
  const consumerFolder = path.join(projectFolder, "consumer");

  await writeModule(ownerFolder, "owner", ownerSource());
  await fs.writeFile(path.join(ownerFolder, "pages.js"), ownerPagesSource());
  await writeModule(consumerFolder, "consumer", consumerSource("v1"));

  await fs.mkdir(path.join(projectFolder, "node_modules"), { recursive: true });
  await fs.symlink(
    ownerFolder,
    path.join(projectFolder, "node_modules", "owner"),
    "dir",
  );

  const config = {
    name: "foreign-package-ownership",
    modules: {
      consumer: {
        source: { type: "local", path: "./consumer", main: "index.js" },
        config: { markerPath: path.join(projectFolder, "marker.txt") },
      },
      owner: {
        source: { type: "local", path: "./owner", main: "index.js" },
      },
    },
  };
  await fs.writeFile(
    path.join(projectFolder, "antelope.config.ts"),
    `export default ${JSON.stringify(config)};\n`,
  );
  return projectFolder;
}

describe("foreign package file ownership", () => {
  afterEach(() => {
    sinon.restore();
    internal.proxyStates.delete(PROXY_IDENTITY);
  });

  it("keeps another module's registrations alive across a consumer reload", async function () {
    this.timeout(30000);

    const projectFolder = await createProject();
    const markerPath = path.join(projectFolder, "marker.txt");
    const consumerIndex = path.join(projectFolder, "consumer", "index.js");
    let manager: ModuleManager | undefined;

    try {
      manager = await launch(projectFolder, "default", { watch: true });

      await waitFor(
        async () => (await readMarker(markerPath)) === "v1:owner-page",
        MARKER_TIMEOUT_MS,
      );
      expect(registeredPages().get("owner-page")?.module).to.equal("owner");

      await fs.writeFile(consumerIndex, consumerSource("v2"));

      await waitFor(
        async () => (await readMarker(markerPath)) === "v2:owner-page",
        MARKER_TIMEOUT_MS,
      );

      expect([...registeredPages().keys()]).to.include("owner-page");
      expect(registeredPages().get("owner-page")?.module).to.equal("owner");
    } finally {
      if (manager) {
        await manager.stopAll();
        await manager.destroyAll();
      }
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });

  it("warns once when a module evaluates files of another module's package", async function () {
    this.timeout(30000);

    const projectFolder = await createProject();
    const markerPath = path.join(projectFolder, "marker.txt");
    const warn = sinon.spy(Logging.Channel.prototype, "Warn");
    let manager: ModuleManager | undefined;

    try {
      manager = await launch(projectFolder, "default", { watch: false });

      await waitFor(
        async () => (await readMarker(markerPath)) === "v1:owner-page",
        MARKER_TIMEOUT_MS,
      );

      const warnings = warn
        .getCalls()
        .map((call) => String(call.args[0]))
        .filter(
          (message) =>
            message.includes("'consumer'") && message.includes("'owner'"),
        );
      expect(warnings).to.have.lengthOf(1);
      expect(warnings[0]).to.contain("interface package");
    } finally {
      if (manager) {
        await manager.stopAll();
        await manager.destroyAll();
      }
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });
});

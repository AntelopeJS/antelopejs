import { expect } from "chai";
import path from "node:path";
import launch from "../../src";
import {
  DownloaderRegistry,
  registerPackageDownloader,
} from "../../src/core/downloaders";
import { NodeFileSystem } from "../../src/core/filesystem";
import { ModuleCache } from "../../src/core/modules";
import {
  cleanupTempDir,
  makeTempDir,
  readText,
  writeJson,
} from "../helpers/temp";

const PACKAGE = "@demo/greeter";
const PINS = { old: "1.0.0", current: "2.0.0" };

/**
 * Packs `greeter` versions into folders under `project`: each one's `construct` appends
 * `<module id>=<its own version>` to `reportFile`.
 */
function packedGreeter(project: string, reportFile: string) {
  const fs = new NodeFileSystem();
  let temps = 0;
  const packed = new Map<string, string>();
  return {
    getTemp: async () => {
      const folder = path.join(project, `pack-${(temps += 1)}`);
      await fs.mkdir(folder, { recursive: true });
      return folder;
    },
    exec: async (command: string, options: { cwd?: string }) => {
      const version = /@([^@"]+)"$/.exec(command)?.[1];
      if (command.startsWith("npm pack") && version) {
        packed.set(options.cwd ?? "", version);
        return { stdout: "greeter.tgz", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
    extract: async (_from: string, to: string) => {
      const version = packed.get(to) ?? "";
      writeJson(path.join(to, "package", "package.json"), {
        name: PACKAGE,
        version,
        main: "index.js",
      });
      await fs.writeFile(
        path.join(to, "package", "index.js"),
        `const fs = require("node:fs");
exports.construct = (config) => {
  fs.appendFileSync(${JSON.stringify(reportFile)}, config.id + "=${version}\\n");
};
`,
      );
    },
    getInstallCommand: async () => "npm install",
  };
}

describe("Launch Function: modules pinning two versions of a package", function () {
  this.timeout(20_000);
  const offline = {
    npm_config_registry: "http://127.0.0.1:9/",
    npm_config_fetch_retries: "0",
  };
  const saved = Object.fromEntries(
    Object.keys(offline).map((key) => [key, process.env[key]]),
  );

  beforeEach(() => {
    Object.assign(process.env, offline);
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("constructs each module from the version it pins", async () => {
    const project = makeTempDir("ajs-package-versions-");
    const reportFile = path.join(project, "constructed.log");
    try {
      const cache = new ModuleCache(path.join(project, "cache"));
      await cache.load();
      const registry = new DownloaderRegistry();
      registerPackageDownloader(registry, packedGreeter(project, reportFile));
      for (const [id, version] of Object.entries(PINS)) {
        await registry.load(project, cache, {
          type: "package",
          package: PACKAGE,
          version,
          id,
        });
      }
      await new NodeFileSystem().writeFile(
        path.join(project, "antelope.config.ts"),
        `export default ${JSON.stringify({
          name: "package-versions",
          cacheFolder: "cache",
          modules: Object.fromEntries(
            Object.entries(PINS).map(([id, version]) => [
              id,
              {
                source: { type: "package", package: PACKAGE, version },
                config: { id },
              },
            ]),
          ),
        })};\n`,
      );

      const manager = await launch(project);
      await manager.stopAll();
      await manager.destroyAll();

      expect(readText(reportFile).trim().split("\n").sort()).to.deep.equal([
        "current=2.0.0",
        "old=1.0.0",
      ]);
    } finally {
      cleanupTempDir(project);
    }
  });
});

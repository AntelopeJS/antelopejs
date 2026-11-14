import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import {
  DownloaderRegistry,
  registerPackageDownloader,
} from "../../../src/core/downloaders";
import { ModuleCache } from "../../../src/core/modules";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";

interface Registry {
  /** The stdout `npm view <pkg>@<spec> version --json` prints. */
  view: string;
  /** The `package.json` text npm packs into every downloaded tarball. */
  packed: string;
}

async function setup(registryData: Registry) {
  const fs = new InMemoryFileSystem();
  const cache = new ModuleCache("/cache", fs);
  await cache.load();
  const commands: string[] = [];
  const registry = new DownloaderRegistry();
  registerPackageDownloader(registry, {
    fs,
    exec: async (command) => {
      commands.push(command);
      if (command.startsWith("npm view")) {
        return { stdout: registryData.view, stderr: "", code: 0 };
      }
      const pack = /^npm pack "pkg@(.+)"$/.exec(command);
      if (pack && (pack[1] === "5" || pack[1] === "not-a-version")) {
        return { stdout: "", stderr: "404 pkg@5", code: 1 };
      }
      return { stdout: "pkg.tgz", stderr: "", code: 0 };
    },
    getTemp: async () => "/tmp/pkg",
    extract: async () => {
      await fs.writeFile("/tmp/pkg/package/package.json", registryData.packed);
    },
    getInstallCommand: async () => "npm install",
  });
  const load = (version: string) => {
    const source: ModuleSourcePackage = {
      type: "package",
      package: "pkg",
      version,
      id: "pkg",
    };
    return registry.load("/project", cache, source);
  };
  const savedManifest = () => fs.readFileString("/cache/manifest.json");
  return { cache, commands, load, savedManifest };
}

describe("PackageDownloader with registry data that breaks its types", () => {
  for (const [label, packedVersion] of [
    ["a number", 1],
    ["null", null],
    ["not semver", "not-a-version"],
  ] as const) {
    it(`caches no version and keeps loading when the packed version is ${label}`, async () => {
      const { load, savedManifest } = await setup({
        view: '["1.0.0"]',
        packed: JSON.stringify({ name: "pkg", version: packedVersion }),
      });

      await load("^1.0.0");

      expect(JSON.parse(await savedManifest())).to.deep.equal({});
      const reloaded = await load("^1.0.0");
      expect(reloaded).to.have.length(1);
    });
  }

  it("resolves a range from the string versions when npm view lists a number", async () => {
    const { commands, load } = await setup({
      view: '[5, "1.1.0"]',
      packed: JSON.stringify({ name: "pkg", version: "1.1.0" }),
    });

    const result = await load("^1.0.0");

    expect(result[0].manifest.version).to.equal("1.1.0");
    expect(commands).to.include('npm pack "pkg@1.1.0"');
  });

  for (const [label, view] of [
    ["a number", "5"],
    ["a string that is not semver", '"not-a-version"'],
  ] as const) {
    it(`serves the cached version when npm view answers a tag with ${label}`, async () => {
      const { cache, commands, load } = await setup({
        view,
        packed: JSON.stringify({ name: "pkg", version: "1.0.0" }),
      });
      await load("1.0.0");
      commands.length = 0;

      const result = await load("latest");

      expect(result[0].manifest.version).to.equal("1.0.0");
      expect(cache.getVersion("pkg@1.0.0")).to.equal("1.0.0");
      expect(
        commands.some((command) => command.startsWith("npm pack")),
      ).to.equal(false);
    });
  }
});

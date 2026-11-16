import { writeFileSync } from "node:fs";
import path from "node:path";

import { equal, exists, exitIs } from "../lib/checks.mts";
import type { Journey, JourneyContext } from "../lib/journey.mts";
import { field, parseJson } from "../lib/json.mts";
import { LocalRegistry } from "../lib/registry.mts";
import { ensureResolver } from "../lib/resolver.mts";

const MODULE = "@verify/module-billing";
const VERSIONS = ["1.0.0", "2.0.0"];
const CACHE = path.join(".antelope", "cache", "@verify");

function publishBilling(registry: LocalRegistry, version: string): void {
  registry.publish({
    name: MODULE,
    version,
    exports: { "./interface": { types: "./dist/interface.d.ts" } },
    files: { "dist/interface.d.ts": `export declare const billing: "${version}";\n` },
  });
}

function configText(version: string, cacheFolder?: string): string {
  const cache = cacheFolder ? `\n  cacheFolder: ${JSON.stringify(cacheFolder)},` : "";
  return `import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "billing",${cache}
  modules: {
    "${MODULE}": { source: { type: "package", package: "${MODULE}", version: "${version}" } },
  },
});
`;
}

/**
 * Builds `app` at 1.0.0 and `other` at 2.0.0 into the cache of `app`, which
 * `other` reaches through an absolute `cacheFolder`. Each build pins its own
 * `build.json`, so the second build's prune keeps the version of the first.
 */
async function fillCache(context: JourneyContext, registry: LocalRegistry, project: string): Promise<void> {
  const env = registry.env(path.join(context.work, "caches"));
  const other = path.join(context.work, "other");
  context.edit("write app at 1.0.0", path.join(project, "antelope.config.ts"), configText("1.0.0"));
  context.edit("write other at 2.0.0, sharing the cache of app", path.join(other, "antelope.config.ts"), configText("2.0.0", path.join(project, ".antelope", "cache")));
  const first = await context.ajs("project build app", ["project", "build"], { cwd: project, env, timeoutMs: 300_000 });
  const second = await context.ajs("project build other", ["project", "build"], { cwd: other, env, timeoutMs: 300_000 });
  const tree = context.tree("tree after both builds", path.join(project, ".antelope", "cache"));
  context.expect(
    tree.folder,
    [exitIs(first, 0), exitIs(second, 0), ...VERSIONS.map((version) => exists(path.join(project, CACHE, `module-billing@${version}`, "dist", "interface.d.ts")))],
    { critical: true },
  );
}

/** The interface resolver of the agent-skills plugin reads what `ajs project build` caches. */
export const journeys: Journey[] = [
  {
    id: "lookup-pinned-cached-version",
    title: "with two versions of a module cached by the CLI, the offline resolver shows the version it is pinned to, not the first it finds",
    entryPoint: "ajs project build (1.0.0); ajs project build in a project sharing its cache (2.0.0); resolve-interface.mjs show @verify/module-billing@<version>/interface --offline",
    async run(context) {
      const registry = new LocalRegistry(path.join(context.work, "registry"));
      await registry.start();
      try {
        for (const version of VERSIONS) {
          publishBilling(registry, version);
        }
        const project = path.join(context.work, "app");
        await fillCache(context, registry, project);
        const resolver = ensureResolver();
        context.note("resolver", `${resolver.script}\nagent-skills ${resolver.ref} at ${resolver.sha}`);
        for (const version of VERSIONS) {
          const shown = await context.node(`resolver show ${version}`, resolver.script, ["show", `${MODULE}@${version}/interface`, "--offline", "--json"], { cwd: project });
          const location = path.join(project, CACHE, `module-billing@${version}`);
          context.expect(shown.folder, [
            exitIs(shown, 0),
            equal(`resolver shows the pinned version ${version}`, field(parseJson(shown.stdout), "version"), version),
            equal(`resolver reads the cache folder of ${version}`, field(parseJson(shown.stdout), "location"), location),
          ]);
        }
      } finally {
        writeFileSync(path.join(context.folder, "registry-requests.txt"), `${registry.requests.join("\n")}\n`);
        await registry.stop();
      }
    },
  },
];

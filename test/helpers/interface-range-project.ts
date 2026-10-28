import { cp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { ModuleManager } from "../../src/core/modules";
import {
  clearRequireCacheWithin,
  createLocalManifest,
  createResolutionFixture,
} from "../core/module-manager.fixtures";

export interface RangeConsumer {
  range: string;
  optional: boolean;
  copy:
    | "missing"
    | "canonical"
    | "private"
    | "preloaded"
    | "canonical-preloaded";
}

export async function constructRangeProject(
  version: string,
  consumers: RangeConsumer[],
  reverse: boolean,
): Promise<{
  error: Error | undefined;
  packageName: string;
  canonicalRoot: string;
  consumerRoots: string[];
}> {
  const fixture = await createResolutionFixture({
    provider: version,
    consumer: "9.9.9",
    range: "*",
  });
  const manager = new ModuleManager();
  try {
    await writeFile(
      path.join(fixture.providerPath, "index.js"),
      "exports.construct = () => {}; exports.destroy = () => {};",
    );
    const provider = await createLocalManifest(fixture.providerPath);
    provider.implements = [fixture.packageName];
    const manifests = [provider];
    const consumerRoots: string[] = [];
    for (const [index, consumer] of consumers.entries()) {
      const folder = path.join(fixture.root, `consumer-${index}`);
      const copyRoot = path.join(folder, "node_modules", fixture.packageName);
      consumerRoots.push(copyRoot);
      await mkdir(path.dirname(copyRoot), { recursive: true });
      await writeFile(
        path.join(folder, "package.json"),
        JSON.stringify({
          name: `consumer-${index}`,
          version: "1.0.0",
          [consumer.optional ? "optionalDependencies" : "dependencies"]: {
            [fixture.packageName]: consumer.range,
          },
        }),
      );
      await writeFile(
        path.join(folder, "index.js"),
        "exports.construct = () => {}; exports.destroy = () => {};",
      );
      if (consumer.copy === "private" || consumer.copy === "preloaded") {
        await cp(fixture.consumerPackageRoot, copyRoot, { recursive: true });
      } else if (consumer.copy !== "missing") {
        await symlink(fixture.providerPackageRoot, copyRoot, "dir");
      }
      if (
        consumer.copy === "preloaded" ||
        consumer.copy === "canonical-preloaded"
      ) {
        createRequire(path.join(folder, "index.js"))(fixture.packageName);
      }
      manifests.push(await createLocalManifest(folder));
    }
    manager.addModules(
      (reverse ? manifests.reverse() : manifests).map((manifest) => ({
        manifest,
      })),
    );
    let error: Error | undefined;
    try {
      await manager.constructAll();
    } catch (caught) {
      if (!(caught instanceof Error)) {
        throw caught;
      }
      error = caught;
    }
    return {
      error,
      packageName: fixture.packageName,
      canonicalRoot: fixture.providerPackageRoot,
      consumerRoots,
    };
  } finally {
    await manager.destroyAll();
    clearRequireCacheWithin(fixture.root);
    await rm(fixture.root, { recursive: true, force: true });
  }
}

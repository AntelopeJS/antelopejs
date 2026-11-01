import { expect } from "chai";

import { findModuleLockfile } from "../../../src/core/output";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";

async function moduleFolder(
  packageManager: string | undefined,
  lockfiles: string[],
): Promise<InMemoryFileSystem> {
  const fs = new InMemoryFileSystem();
  await fs.writeFile(
    "/module/package.json",
    JSON.stringify({ name: "module", version: "1.0.0", packageManager }),
  );
  for (const lockfile of lockfiles) {
    await fs.writeFile(`/module/${lockfile}`, "lock");
  }
  return fs;
}

describe("findModuleLockfile", () => {
  it("picks the lockfile of the module's own package manager when several are present", async () => {
    const both = ["package-lock.json", "pnpm-lock.yaml"];

    const pnpm = await findModuleLockfile(
      "/module",
      await moduleFolder("pnpm@10.6.5", both),
    );
    const npm = await findModuleLockfile(
      "/module",
      await moduleFolder("npm@10.2.4", both),
    );

    expect([pnpm, npm]).to.deep.equal(["pnpm-lock.yaml", "package-lock.json"]);
  });

  it("falls back to npm's lockfiles for a module that names no package manager", async () => {
    const found = await findModuleLockfile(
      "/module",
      await moduleFolder(undefined, ["npm-shrinkwrap.json", "yarn.lock"]),
    );

    expect(found).to.equal("npm-shrinkwrap.json");
  });

  it("finds nothing when the package manager wrote no lockfile", async () => {
    const found = await findModuleLockfile(
      "/module",
      await moduleFolder("yarn@1.22.21", ["pnpm-lock.yaml"]),
    );

    expect(found).to.equal(undefined);
  });
});

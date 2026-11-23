import { expect } from "chai";
import sinon from "sinon";

import { getInstallCommand } from "../../../src/core/output";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";

describe("getInstallCommand in a pnpm workspace", () => {
  beforeEach(() => {
    sinon
      .stub(require("node:child_process"), "execSync")
      .throws(new Error("corepack not found"));
  });
  afterEach(() => sinon.restore());

  async function workspace(packages: string): Promise<InMemoryFileSystem> {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/repo/pnpm-workspace.yaml", packages);
    await fs.writeFile("/repo/pnpm-lock.yaml", "");
    await fs.writeFile(
      "/repo/modules/app/package.json",
      JSON.stringify({ name: "app" }),
    );
    return fs;
  }

  it("installs a member through its workspace", async () => {
    const fs = await workspace(
      "packages:\n  - 'modules/*' # every module\n  - \"!**/test/**\"\n",
    );

    expect(
      await getInstallCommand("/repo/modules/app", false, fs, "update"),
    ).to.equal("pnpm install --no-frozen-lockfile --prefer-offline");
  });

  it("installs a member a recursive pattern lists through its workspace", async () => {
    const fs = await workspace("packages:\n  - ./**\n  - '!**/test/**'\n");

    expect(
      await getInstallCommand("/repo/modules/app", false, fs, "update"),
    ).to.match(/^pnpm install (?!.*--ignore-workspace)/);
  });

  for (const packages of [
    "packages:\n- modules/*\n",
    "packages: [modules/*]\n",
    "packages: ['other/*', \"modules/*\"] # flow list\n",
    "packages: [\n  other/*,\n  modules/*\n]\n",
    "packages:\n  - 'my mods/*'\n  - modules/*\n",
  ]) {
    it(`installs a member that ${JSON.stringify(packages)} lists through its workspace`, async () => {
      const fs = await workspace(packages);

      expect(
        await getInstallCommand("/repo/modules/app", false, fs, "update"),
      ).to.match(/^pnpm install (?!.*--ignore-workspace)/);
    });
  }

  it("installs a member that a quoted entry with a space lists through its workspace", async () => {
    const fs = await workspace("packages:\n  - 'my mods/*'\n");
    await fs.writeFile(
      "/repo/my mods/app/package.json",
      JSON.stringify({ name: "app" }),
    );

    expect(
      await getInstallCommand("/repo/my mods/app", false, fs, "update"),
    ).to.match(/^pnpm install (?!.*--ignore-workspace)/);
  });

  for (const packages of [
    "base: &modules\n  - modules/*\npackages: *modules\n",
    "base: &globs\n  packages: [modules/*]\n<<: *globs\n",
  ]) {
    it(`installs a member that ${JSON.stringify(packages)} lists through an alias`, async () => {
      const fs = await workspace(packages);

      expect(
        await getInstallCommand("/repo/modules/app", false, fs, "update"),
      ).to.match(/^pnpm install (?!.*--ignore-workspace)/);
    });
  }

  for (const pattern of [
    "modules/{app,lib}",
    "modules/[ab]pp",
    "modules/ap?",
  ]) {
    it(`installs a member the glob ${pattern} lists through its workspace`, async () => {
      const fs = await workspace(`packages:\n  - '${pattern}'\n`);

      expect(
        await getInstallCommand("/repo/modules/app", false, fs, "update"),
      ).to.match(/^pnpm install (?!.*--ignore-workspace)/);
    });
  }

  for (const member of ["/repo/.hidden/app", "/repo/vendor/node_modules/app"]) {
    it(`installs ${member}, which pnpm's ** search skips, alone`, async () => {
      const fs = await workspace("packages:\n  - '**'\n");
      await fs.writeFile(
        `${member}/package.json`,
        JSON.stringify({ name: "app" }),
      );

      expect(await getInstallCommand(member, false, fs, "update")).to.equal(
        "npm install",
      );
    });
  }

  it("installs a folder the workspace does not list alone", async () => {
    const fs = await workspace("packages:\n  - packages/**\n");

    expect(
      await getInstallCommand("/repo/modules/app", false, fs, "update"),
    ).to.equal("npm install");
  });

  it("installs a folder an exclusion pattern removes alone", async () => {
    const fs = await workspace(
      "packages:\n  - modules/*\n  - '!modules/app'\n",
    );

    expect(
      await getInstallCommand("/repo/modules/app", false, fs, "update"),
    ).to.equal("npm install");
  });
});

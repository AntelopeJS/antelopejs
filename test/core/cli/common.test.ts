import { expect } from "chai";
import nodeFs from "node:fs";
import nodePath from "node:path";
import sinon from "sinon";

import {
  DEFAULT_GIT_REPO,
  detectIndentation,
  displayNonDefaultGitWarning,
  readConfig,
  readModuleManifest,
  readUserConfig,
  writeConfig,
  writeModuleManifest,
  writeUserConfig,
} from "../../../src/cli";
import { tsConfigFileModule as tsConfigFile } from "../../../src/core/config";
import { getProcessUi } from "../../../src/core/output";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";
import { cleanupTempDir, makeTempDir } from "../../helpers/temp";

{
  let registerCLICommon: (this: Mocha.Suite) => void;

  let registerDetectIndentation: (this: Mocha.Suite) => void;
  {
    registerDetectIndentation = () => {
      it("should detect 2-space indentation", async () => {
        const fs = new InMemoryFileSystem();
        await fs.writeFile("/test.json", '{\n  "a": 1\n}');
        const indent = await detectIndentation("/test.json", fs);
        expect(indent).to.equal("  ");
      });

      it("should detect tab indentation", async () => {
        const fs = new InMemoryFileSystem();
        await fs.writeFile("/test.json", '{\n\t"a": 1\n}');
        const indent = await detectIndentation("/test.json", fs);
        expect(indent).to.equal("\t");
      });
    };
  }

  let registerUserConfig: (this: Mocha.Suite) => void;
  {
    const initializeOriginalHome = () => process.env.HOME;
    let originalHome: ReturnType<typeof initializeOriginalHome>;

    const initializeTempHome = () => "";
    let tempHome: ReturnType<typeof initializeTempHome>;

    registerUserConfig = () => {
      originalHome = initializeOriginalHome();
      tempHome = initializeTempHome();

      beforeEach(() => {
        tempHome = makeTempDir("antelope-home-");
        process.env.HOME = tempHome;
      });

      afterEach(() => {
        process.env.HOME = originalHome;
        cleanupTempDir(tempHome);
        sinon.restore();
      });

      it("returns default config when missing", async () => {
        const config = await readUserConfig();
        expect(config.git).to.equal(DEFAULT_GIT_REPO);
      });

      it("writes and reads user config", async () => {
        await writeUserConfig({ git: "https://example.com/repo.git" });
        const config = await readUserConfig();
        expect(config.git).to.equal("https://example.com/repo.git");
      });

      it("falls back to default config when config file is null", async () => {
        const configDir = nodePath.join(tempHome, ".antelopejs");
        nodeFs.mkdirSync(configDir, { recursive: true });
        nodeFs.writeFileSync(nodePath.join(configDir, "config.json"), "null");

        const config = await readUserConfig();
        expect(config.git).to.equal(DEFAULT_GIT_REPO);
      });
    };
  }

  let registerDisplayNonDefaultGitWarning: (this: Mocha.Suite) => void;
  {
    registerDisplayNonDefaultGitWarning = () => {
      afterEach(() => {
        sinon.restore();
      });

      it("shows one warning for a non-default repo without waiting", () => {
        const messageStub = sinon.stub(getProcessUi(), "message");

        displayNonDefaultGitWarning("https://example.com/repo.git");

        expect(messageStub.calledOnce).to.equal(true);
        expect(messageStub.firstCall.args.slice(0, 2)).to.deep.equal([
          "warn",
          "Using a non-default git repository",
        ]);
      });

      it("stays quiet for the default repo", () => {
        const messageStub = sinon.stub(getProcessUi(), "message");

        displayNonDefaultGitWarning(DEFAULT_GIT_REPO);

        expect(messageStub.called).to.equal(false);
      });
    };
  }

  let registerReadConfig: (this: Mocha.Suite) => void;
  {
    registerReadConfig = () => {
      it("should read antelope.config.ts", async () => {
        const fs = new InMemoryFileSystem();
        await fs.writeFile("/project/antelope.config.ts", "export default {}");
        sinon
          .stub(tsConfigFile, "loadTsConfigFile")
          .resolves({ name: "ts-project" });
        const config = await readConfig("/project", fs);
        expect(config?.name).to.equal("ts-project");
      });

      it("returns undefined when antelope.config.ts is missing", async () => {
        const fs = new InMemoryFileSystem();
        const config = await readConfig("/missing", fs);
        expect(config).to.equal(undefined);
      });
    };
  }

  let registerModuleManifest: (this: Mocha.Suite) => void;
  {
    registerModuleManifest = () => {
      it("writes and reads package.json manifest", async () => {
        const fs = new InMemoryFileSystem();
        await writeModuleManifest(
          "/module",
          { name: "mod", version: "1.0.0" },
          fs,
        );
        const manifest = await readModuleManifest("/module", fs);
        expect(manifest?.name).to.equal("mod");
      });

      it("returns undefined when package.json is missing", async () => {
        const fs = new InMemoryFileSystem();
        const manifest = await readModuleManifest("/module", fs);
        expect(manifest).to.equal(undefined);
      });
    };
  }

  let registerWriteConfig: (this: Mocha.Suite) => void;
  {
    registerWriteConfig = () => {
      it("writes antelope.config.ts with default content when config is missing", async () => {
        const fs = new InMemoryFileSystem();
        await writeConfig("/project", { name: "demo" }, fs);
        const contents = await fs.readFileString("/project/antelope.config.ts");
        expect(contents).to.include(
          "import { defineConfig } from '@antelopejs/interface-core/config';",
        );
        expect(contents).to.include("export default defineConfig({");
        expect(contents).to.include('name: "demo"');
      });

      it("writes antelope.config.ts when using object export", async () => {
        const fs = new InMemoryFileSystem();
        await fs.writeFile(
          "/project/antelope.config.ts",
          'export default { name: "demo" };',
        );
        await writeConfig("/project", { name: "updated" }, fs);
        const contents = await fs.readFileString("/project/antelope.config.ts");
        expect(contents).to.include("export default {");
        expect(contents).to.include('name: "updated"');
      });

      it("writes antelope.config.ts when using defineConfig with object", async () => {
        const fs = new InMemoryFileSystem();
        await fs.writeFile(
          "/project/antelope.config.ts",
          "import { defineConfig } from '@antelopejs/interface-core/config';\nexport default defineConfig({ name: 'demo' });\n",
        );
        await writeConfig("/project", { name: "updated" }, fs);
        const contents = await fs.readFileString("/project/antelope.config.ts");
        expect(contents).to.include(
          "import { defineConfig } from '@antelopejs/interface-core/config';",
        );
        expect(contents).to.include("export default defineConfig({");
        expect(contents).to.include('name: "updated"');
      });

      it("throws for function-based antelope.config.ts exports", async () => {
        const fs = new InMemoryFileSystem();
        await fs.writeFile(
          "/project/antelope.config.ts",
          "import { defineConfig } from '@antelopejs/interface-core/config';\n" +
            "export default defineConfig(() => ({ name: 'demo' }));\n",
        );

        try {
          await writeConfig("/project", { name: "updated" }, fs);
          expect.fail("should have thrown");
        } catch (error: any) {
          expect(error.message).to.include("function-based");
        }
      });
    };
  }

  registerCLICommon = () => {
    afterEach(() => {
      sinon.restore();
    });
    describe("detectIndentation", function () {
      registerDetectIndentation.call(this);
    });
    describe("user config", function () {
      registerUserConfig.call(this);
    });
    describe("displayNonDefaultGitWarning", function () {
      registerDisplayNonDefaultGitWarning.call(this);
    });
    describe("readConfig", function () {
      registerReadConfig.call(this);
    });
    describe("module manifest", function () {
      registerModuleManifest.call(this);
    });
    describe("writeConfig", function () {
      registerWriteConfig.call(this);
    });
  };

  describe("CLI Common", function () {
    registerCLICommon.call(this);
  });
}

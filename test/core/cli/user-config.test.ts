import { expect } from "chai";
import fs from "node:fs";
import path from "node:path";

import sinon from "sinon";

import {
  commandsConfigResetCommand as cmdReset,
  DEFAULT_GIT_REPO,
  readUserConfig,
} from "../../../src/cli";
import { CliError } from "../../../src/core/output";
import { collectStderr } from "../../helpers/capture-output";
import { cleanupTempDir, makeTempDir } from "../../helpers/temp";
import { rejectionOf } from "./fixtures";

describe("the CLI configuration file", () => {
  let home: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    home = makeTempDir("ajs-user-config-");
    process.env.HOME = home;
    fs.mkdirSync(path.join(home, ".antelopejs"));
  });

  afterEach(() => {
    sinon.restore();
    process.env.HOME = originalHome;
    cleanupTempDir(home);
  });

  const writeConfig = (content: string) =>
    fs.writeFileSync(path.join(home, ".antelopejs", "config.json"), content);

  it("refuses a configuration without a string git value", async () => {
    writeConfig("{}");
    const error = await rejectionOf(readUserConfig());
    expect(error).to.be.instanceOf(CliError);
  });

  it("keeps the other values it holds", async () => {
    writeConfig('{"git":"https://example.com/c.git","extra":"kept"}');
    const config = await readUserConfig();
    expect(config).to.deep.equal({
      git: "https://example.com/c.git",
      extra: "kept",
    });
  });

  for (const [kind, content] of [
    ["a value that is not an object with a git string", "[1]"],
    ["text that is not JSON", "{bad"],
  ]) {
    it(`resets a file that holds ${kind}`, async () => {
      writeConfig(content);
      const feedback = collectStderr();

      await cmdReset().parseAsync(["node", "test", "--yes"]);

      expect(await readUserConfig()).to.deep.equal({ git: DEFAULT_GIT_REPO });
      expect(feedback()).to.equal(
        [
          "✔ Reset the configuration to its default values",
          "",
          `git  invalid → ${DEFAULT_GIT_REPO}`,
          "",
        ].join("\n"),
      );
    });
  }
});

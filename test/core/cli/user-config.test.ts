import { expect } from "chai";
import fs from "node:fs";
import path from "node:path";

import { readUserConfig } from "../../../src/cli";
import { CliError } from "../../../src/core/output";
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
});

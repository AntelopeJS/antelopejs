import { expect } from "chai";

import {
  findOfficialPlugin,
  formatOfficialPluginsHelp,
  listOfficialPlugins,
  officialPluginLabel,
  officialPluginNames,
} from "../../../src/core/cli/plugin-registry";

describe("Official plugin registry", () => {
  it("describes the DMS plugin", () => {
    expect(findOfficialPlugin("dms")).to.deep.equal({
      name: "dms",
      package: "@antelopejs/dms-frontend",
      bin: "ajs-dms",
      description: "DMS frontend commands",
    });
  });

  it("returns undefined for unknown plugins", () => {
    expect(findOfficialPlugin("unknown")).to.equal(undefined);
  });

  it("lists plugins and their names", () => {
    expect(officialPluginNames()).to.deep.equal(["dms"]);
    expect(listOfficialPlugins().map((plugin) => plugin.bin)).to.deep.equal([
      "ajs-dms",
    ]);
  });

  it("labels plugins for user facing messages", () => {
    const plugin = findOfficialPlugin("dms");
    if (!plugin) throw new Error("dms plugin missing");
    expect(officialPluginLabel(plugin)).to.equal("DMS");
  });

  it("formats the registry for the CLI help", () => {
    const help = formatOfficialPluginsHelp();
    expect(help).to.contain("dms");
    expect(help).to.contain("@antelopejs/dms-frontend");
    expect(help).to.contain("DMS frontend commands");
  });
});

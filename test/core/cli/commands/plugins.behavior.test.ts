import sinon from "sinon";
import { expect } from "chai";

import cmdUpdate from "../../../../src/core/cli/commands/update";
import cmdPlugins from "../../../../src/core/cli/commands/plugins";
import * as pluginManagement from "../../../../src/core/cli/plugin-management";
import { createMemoryUi } from "../../../helpers/memory-ui";

const INCOMPATIBLE_DMS: pluginManagement.PluginStatus = {
  plugin: {
    name: "dms",
    package: "@antelopejs/dms-frontend",
    bin: "ajs-dms",
    description: "DMS frontend commands",
  },
  executablePath: "/usr/bin/ajs-dms",
  source: "path",
  version: "0.9.0",
  compatibility: {
    status: "incompatible",
    requiredRange: "^2.0.0",
    pluginVersion: "0.9.0",
  },
};

describe("plugin commands behavior", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("updates everything when no plugin is given", async () => {
    const updateStub = sinon.stub(pluginManagement, "runUpdate").resolves(0);

    await cmdUpdate().parseAsync(["node", "test"]);

    expect(updateStub.calledOnceWith(undefined)).to.equal(true);
    expect(process.exitCode).to.equal(0);
  });

  it("updates a single plugin and propagates the exit code", async () => {
    const updateStub = sinon.stub(pluginManagement, "runUpdate").resolves(2);

    await cmdUpdate().parseAsync(["node", "test", "dms"]);

    expect(updateStub.calledOnceWith("dms")).to.equal(true);
    expect(process.exitCode).to.equal(2);
  });

  it("lists official plugins as a table with their compatibility", async () => {
    sinon
      .stub(pluginManagement, "getPluginStatuses")
      .resolves([INCOMPATIBLE_DMS]);
    const { ui, result, feedback } = createMemoryUi();

    await cmdPlugins(ui).parseAsync(["node", "test"]);

    expect(result.text).to.equal(
      "dms\t@antelopejs/dms-frontend\t0.9.0\tglobal\tneeds @antelopejs/core ^2.0.0\t/usr/bin/ajs-dms\n",
    );
    expect(feedback.text).to.equal("→ Run ajs update dms to update dms\n");
  });

  it("lists official plugins through the list subcommand", async () => {
    const statusStub = sinon
      .stub(pluginManagement, "getPluginStatuses")
      .resolves([]);
    const { ui } = createMemoryUi();

    await cmdPlugins(ui).parseAsync(["node", "test", "list"]);

    expect(statusStub.calledOnce).to.equal(true);
  });

  [["--json"], ["list", "--json"], ["--json", "list"]].forEach((args) => {
    it(`prints the plugins as JSON with ${args.join(" ")}`, async () => {
      sinon
        .stub(pluginManagement, "getPluginStatuses")
        .resolves([INCOMPATIBLE_DMS]);
      const { ui, result, feedback } = createMemoryUi();

      await cmdPlugins(ui).parseAsync(["node", "test", ...args]);

      expect(JSON.parse(result.text)).to.deep.equal([
        {
          name: "dms",
          package: "@antelopejs/dms-frontend",
          description: "DMS frontend commands",
          state: "incompatible",
          source: "global",
          path: "/usr/bin/ajs-dms",
          version: "0.9.0",
          requiredCoreRange: "^2.0.0",
        },
      ]);
      expect(feedback.text).to.equal("");
    });
  });
});

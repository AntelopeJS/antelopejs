import sinon from "sinon";
import { expect } from "chai";

import * as cliUi from "../../../../src/core/cli/cli-ui";
import cmdUpdate from "../../../../src/core/cli/commands/update";
import cmdPlugins from "../../../../src/core/cli/commands/plugins";
import * as pluginManagement from "../../../../src/core/cli/plugin-management";

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

  it("lists official plugins with their state", async () => {
    sinon.stub(cliUi, "header");
    const logStub = sinon.stub(console, "log");
    sinon.stub(pluginManagement, "getPluginStatuses").resolves([
      {
        plugin: {
          name: "dms",
          package: "@antelopejs/dms-frontend",
          bin: "ajs-dms",
          description: "DMS frontend commands",
        },
        executablePath: "/usr/bin/ajs-dms",
        version: "1.0.0",
      },
    ]);

    await cmdPlugins().parseAsync(["node", "test"]);

    const output = logStub.getCalls().map((call) => String(call.args[0]));
    expect(output.join("\n")).to.contain("@antelopejs/dms-frontend");
    expect(output.join("\n")).to.contain("installed (1.0.0)");
  });

  it("lists official plugins through the list subcommand", async () => {
    sinon.stub(cliUi, "header");
    sinon.stub(console, "log");
    const statusStub = sinon
      .stub(pluginManagement, "getPluginStatuses")
      .resolves([]);

    await cmdPlugins().parseAsync(["node", "test", "list"]);

    expect(statusStub.calledOnce).to.equal(true);
  });
});

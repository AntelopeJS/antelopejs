import { expect } from "chai";
import sinon from "sinon";

import {
  commandsProjectModulesUpdateCommand as cmdUpdate,
  commonModule as common,
} from "../../../../../src/cli";
import { getProcessUi } from "../../../../../src/core/output";
import { stubLoadedConfig } from "../../fixtures";
describe("project modules behavior: update-default-environment", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("shows up to date when no npm modules are available to update", async () => {
    sinon.stub(common, "readConfig").resolves({
      name: "proj",
      modules: {
        git: {
          source: { type: "git", remote: "https://example.com/repo.git" },
        },
      },
    });
    stubLoadedConfig({
      modules: {
        git: {
          source: { type: "git", remote: "https://example.com/repo.git" },
        },
      },
    });
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    const cmd = cmdUpdate();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(summaryStub.firstCall.args[0]).to.deep.include({
      headline: "Nothing to update: no module comes from npm",
      nextSteps: [],
    });
  });

  it("updates the root config when the default environment is named", async () => {
    sinon.stub(common, "readConfig").resolves({
      name: "proj",
      modules: {
        git: {
          source: { type: "git", remote: "https://example.com/repo.git" },
        },
      },
    });
    const loadStub = stubLoadedConfig({
      modules: {
        git: {
          source: { type: "git", remote: "https://example.com/repo.git" },
        },
      },
    });
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    await cmdUpdate().parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
      "--env",
      "default",
    ]);

    expect(loadStub.firstCall.args[1]).to.equal("default");
    expect(summaryStub.calledOnce).to.equal(true);
  });
});

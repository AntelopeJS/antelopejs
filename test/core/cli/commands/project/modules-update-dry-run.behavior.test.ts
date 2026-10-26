import type { AntelopeConfig } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import sinon from "sinon";

import {
  commandsProjectModulesUpdateCommand as cmdUpdate,
  commonModule as common,
} from "../../../../../src/cli";
import {
  commandModule as command,
  getProcessUi,
  stripAnsi,
} from "../../../../../src/core/output";
import { useAsciiSymbols } from "../../../../helpers/ascii-symbols";
import { stubLoadedConfig } from "../../fixtures";

function messageLines(stub: sinon.SinonStub): string[] {
  return stub
    .getCalls()
    .map((call) => stripAnsi(`${call.args[0]} ${call.args[1]}`));
}
describe("project modules behavior: update-dry-run", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("checks only the requested modules in a dry run", async () => {
    const modules = {
      pkg1: {
        source: { type: "package", package: "pkg1", version: "1.0.0" },
      },
      pkgSame: {
        source: { type: "package", package: "pkgSame", version: "1.0.0" },
      },
      unrequested: {
        source: { type: "package", package: "unrequested", version: "1.0.0" },
      },
      gitMod: {
        source: { type: "git", remote: "https://example.com/repo.git" },
      },
    } satisfies AntelopeConfig["modules"];
    sinon.stub(common, "readConfig").resolves({ name: "proj", modules });
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    stubLoadedConfig({ modules });

    const execStub = sinon.stub(command, "ExecuteFile");
    execStub.onFirstCall().resolves({ code: 0, stdout: "2.0.0", stderr: "" });
    execStub.onSecondCall().resolves({ code: 0, stdout: "1.0.0", stderr: "" });

    const messageStub = sinon.stub(getProcessUi(), "message");
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    const cmd = cmdUpdate();
    await cmd.parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
      "--dry-run",
      "pkg1",
      "pkgSame",
      "gitMod",
    ]);

    const checkedCommands = execStub
      .getCalls()
      .map((call) => call.args[1].join(" "));
    expect(checkedCommands).to.have.length(2);
    expect(checkedCommands.join("\n")).to.not.include("unrequested");
    expect(messageLines(messageStub)).to.deep.equal([
      "info Would update pkg1 1.0.0 → 2.0.0",
    ]);
    expect(summaryStub.firstCall.args[0]).to.deep.include({
      headline:
        "Dry run: 1 module can be updated · antelope.config.ts unchanged",
      nextSteps: [
        {
          command:
            "ajs project modules update pkg1 pkgSame gitMod --project /tmp/project",
          description: "apply these updates",
        },
      ],
    });
    expect(writeStub.called).to.equal(false);
    expect(process.exitCode).to.equal(undefined);
  });

  it("points to the new versions in ASCII on a dry run", async () => {
    useAsciiSymbols();
    const modules = {
      pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
    } satisfies AntelopeConfig["modules"];
    sinon.stub(common, "readConfig").resolves({ name: "proj", modules });
    stubLoadedConfig({ modules });
    sinon
      .stub(command, "ExecuteFile")
      .resolves({ code: 0, stdout: "2.0.0", stderr: "" });
    const messageStub = sinon.stub(getProcessUi(), "message");
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    await cmdUpdate().parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
      "--dry-run",
    ]);

    expect(messageLines(messageStub)).to.deep.equal([
      "info Would update pkg 1.0.0 -> 2.0.0",
    ]);
    expect(summaryStub.firstCall.args[0].headline).to.equal(
      "Dry run: 1 module can be updated - antelope.config.ts unchanged",
    );
  });
});

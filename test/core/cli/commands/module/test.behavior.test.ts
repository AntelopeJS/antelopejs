import os from "node:os";
import sinon from "sinon";
import path from "node:path";
import { expect } from "chai";
import { mkdtemp, rm } from "node:fs/promises";

import { CliError, getProcessUi } from "../../../../../src/core/cli/output";
import * as common from "../../../../../src/core/cli/common";
import * as testModuleModule from "../../../../../src/core/test/test-module";
import cmdTest from "../../../../../src/core/cli/commands/module/test";
import { moduleTestCommand } from "../../../../../src/core/cli/commands/module/test-action";

describe("module test behavior", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("fails once when the module directory does not exist", async () => {
    const testStub = sinon.stub(testModuleModule, "TestModule").resolves(0);
    const missing = path.join(os.tmpdir(), "ajs-missing-module-directory");

    const failure = await moduleTestCommand(missing, { file: [] }).catch(
      (err: unknown) => err,
    );

    expect(failure).to.be.instanceOf(CliError);
    expect((failure as CliError).problem.title).to.equal(
      `Directory ${missing} does not exist`,
    );
    expect(testStub.called).to.equal(false);
  });

  it("fails once when the directory holds no module", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ajs-no-module-"));
    sinon.stub(testModuleModule, "TestModule").resolves(0);

    try {
      const failure = await moduleTestCommand(directory, { file: [] }).catch(
        (err: unknown) => err,
      );

      expect((failure as CliError).problem).to.include({
        title: `No AntelopeJS module in ${directory}`,
        reason: "The directory has no readable package.json.",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("runs TestModule when module is valid", async () => {
    sinon.stub(common, "readModuleManifest").resolves({ name: "modA" } as any);
    sinon.stub(getProcessUi(), "message");

    const testStub = sinon.stub(testModuleModule, "TestModule").resolves(0);

    await moduleTestCommand("/tmp/module", { file: ["/tmp/test.ts"] });

    expect(testStub.calledOnce).to.equal(true);
    expect(testStub.firstCall.args[0]).to.equal(path.resolve("/tmp/module"));
    expect(testStub.firstCall.args[1]).to.deep.equal(["/tmp/test.ts"]);
  });

  it("sets exitCode=1 when TestModule reports failures", async () => {
    sinon.stub(common, "readModuleManifest").resolves({ name: "modA" } as any);
    sinon.stub(getProcessUi(), "message");
    sinon.stub(testModuleModule, "TestModule").resolves(3);

    await moduleTestCommand("/tmp/module", { file: [] });

    expect(process.exitCode).to.equal(1);
  });

  it("leaves exitCode unset when TestModule reports zero failures", async () => {
    sinon.stub(common, "readModuleManifest").resolves({ name: "modA" } as any);
    sinon.stub(getProcessUi(), "message");
    sinon.stub(testModuleModule, "TestModule").resolves(0);

    await moduleTestCommand("/tmp/module", { file: [] });

    expect(process.exitCode).to.equal(undefined);
  });

  it("parses file options and forwards them", async () => {
    sinon.stub(common, "readModuleManifest").resolves({ name: "modA" } as any);
    sinon.stub(getProcessUi(), "message");

    const testStub = sinon.stub(testModuleModule, "TestModule").resolves(0);

    const cmd = cmdTest();
    await cmd.parseAsync([
      "node",
      "test",
      "/tmp/module",
      "--file",
      "/tmp/a.test.ts",
      "--file",
      "/tmp/b.test.ts",
    ]);

    expect(testStub.calledOnce).to.equal(true);
    expect(testStub.firstCall.args[1]).to.deep.equal([
      path.resolve("/tmp/a.test.ts"),
      path.resolve("/tmp/b.test.ts"),
    ]);
  });
});

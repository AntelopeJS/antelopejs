import { expect } from "chai";
import sinon from "sinon";

import { handlers } from "../../../../../src/cli";
import { commandModule as command } from "../../../../../src/core/output";
describe("project modules behavior: package-versions", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("package handler resolves latest version as a floating caret range", async () => {
    const execStub = sinon
      .stub(command, "ExecuteFile")
      .resolves({ code: 0, stdout: "1.2.3", stderr: "" });
    const handler = handlers.get("package")!;
    const [name, config] = await handler("pkg", {
      mode: "package",
      project: "/tmp/project",
    });

    expect(execStub.called).to.equal(true);
    expect(name).to.equal("pkg");
    expect(config).to.have.nested.property("source.version", "^1.2.3");
  });

  it("package handler keeps an explicit semver range without registry lookup", async () => {
    const execStub = sinon.stub(command, "ExecuteFile");
    const handler = handlers.get("package")!;
    const [name, config] = await handler("pkg@^2.0.0", {
      mode: "package",
      project: "/tmp/project",
    });

    expect(execStub.called).to.equal(false);
    expect(name).to.equal("pkg");
    expect(config).to.have.nested.property("source.version", "^2.0.0");
  });

  it("package handler accepts a registry dist-tag", async () => {
    const execStub = sinon.stub(command, "ExecuteFile").resolves({
      code: 0,
      stdout: '{"latest":"1.0.0","beta":"2.0.0-beta.1"}',
      stderr: "",
    });
    const handler = handlers.get("package")!;
    const [name, config] = await handler("pkg@beta", {
      mode: "package",
      project: "/tmp/project",
    });

    expect(execStub.firstCall.args[1]).to.include("dist-tags");
    expect(name).to.equal("pkg");
    expect(config).to.have.nested.property("source.version", "beta");
  });

  it("package handler rejects a spec that is neither range nor dist-tag", async () => {
    sinon.stub(command, "ExecuteFile").resolves({
      code: 0,
      stdout: '{"latest":"1.0.0"}',
      stderr: "",
    });
    const handler = handlers.get("package")!;
    let caught: unknown;
    try {
      await handler("pkg@lastest", {
        mode: "package",
        project: "/tmp/project",
      });
    } catch (err) {
      caught = err;
    }
    expect(String(caught)).to.include(
      "neither a valid semver range nor a dist-tag",
    );
  });

  it("package handler throws when version fetch fails", async () => {
    sinon
      .stub(command, "ExecuteFile")
      .resolves({ code: 1, stdout: "", stderr: "oops" });
    const handler = handlers.get("package")!;
    let caught: unknown;
    try {
      await handler("pkg", { mode: "package", project: "/tmp/project" });
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(Error);
  });
});

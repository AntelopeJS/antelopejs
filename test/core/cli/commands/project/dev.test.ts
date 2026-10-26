import sinon from "sinon";
import { expect } from "chai";
import { ChildProcess } from "node:child_process";

import { terminateChildProcess } from "../../../../../src/cli/commands/project/dev-action";

describe("dev command child process", () => {
  it("should send SIGTERM and resolve when child exits", async () => {
    const child = new ChildProcess();
    const kill = sinon.stub(child, "kill").returns(true);
    const termination = terminateChildProcess(child);
    setTimeout(() => child.emit("exit", 0, null), 5);
    await termination;

    expect(kill.calledWith("SIGTERM")).to.equal(true);
  });

  it("should send SIGKILL after timeout when child does not exit", async () => {
    const clock = sinon.useFakeTimers();
    const child = sinon.createStubInstance(ChildProcess);
    child.kill.returns(true);

    const terminatePromise = terminateChildProcess(child, 100);
    clock.tick(100);

    await terminatePromise;

    expect(child.kill.calledWith("SIGTERM")).to.equal(true);
    expect(child.kill.calledWith("SIGKILL")).to.equal(true);

    clock.restore();
  });
});

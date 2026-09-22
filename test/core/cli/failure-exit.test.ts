import sinon from "sinon";
import { expect } from "chai";

import { forceExitOnFailure } from "../../../src/core/cli/failure-exit";

describe("forceExitOnFailure", () => {
  let exitStub: sinon.SinonStub;
  let clock: sinon.SinonFakeTimers;
  let previousExitCode: typeof process.exitCode;

  beforeEach(() => {
    previousExitCode = process.exitCode;
    exitStub = sinon.stub(process, "exit");
    clock = sinon.useFakeTimers();
  });

  afterEach(() => {
    clock.restore();
    exitStub.restore();
    process.exitCode = previousExitCode;
  });

  it("schedules nothing when the run succeeded", () => {
    process.exitCode = 0;

    expect(forceExitOnFailure()).to.equal(undefined);

    clock.tick(60000);
    expect(exitStub.called).to.equal(false);
  });

  it("schedules nothing when no exit code was requested", () => {
    process.exitCode = undefined;

    expect(forceExitOnFailure()).to.equal(undefined);
  });

  it("exits with the failing code once the grace period elapsed", () => {
    process.exitCode = 1;

    const timer = forceExitOnFailure(2000);

    expect(exitStub.called).to.equal(false);
    clock.tick(2000);
    expect(exitStub.calledOnceWithExactly(1)).to.equal(true);
    expect(timer).to.not.equal(undefined);
  });

  it("keeps the timer from holding the process open on its own", () => {
    process.exitCode = 3;

    const timer = forceExitOnFailure();

    expect(timer?.hasRef()).to.equal(false);
    clock.tick(60000);
    expect(exitStub.calledOnceWithExactly(3)).to.equal(true);
  });
});

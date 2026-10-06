import sinon from "sinon";
import { expect } from "chai";
import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";

import * as cliUi from "../../src/core/cli/cli-ui";
import * as command from "../../src/core/cli/command";
import type { ExpandedModuleConfig } from "../../src/core/config/config-parser";
import { checkOutdatedModules } from "../../src/core/version-checker";
import {
  installHangingNpm,
  isRunning,
  readPid,
  waitFor,
} from "../helpers/hanging-npm";

const CANCELLED_CHECK_BUDGET_MS = 1000;

function packageModules(): Record<string, ExpandedModuleConfig> {
  const source: ModuleSourcePackage = {
    type: "package",
    package: "mod-a",
    version: "1.0.0",
  };
  return {
    "mod-a": { source, config: {}, importOverrides: [], disabledExports: [] },
  };
}

describe("version-checker cancellation", () => {
  beforeEach(() => {
    sinon.stub(cliUi, "info");
  });

  afterEach(() => {
    sinon.restore();
  });

  it("stops waiting for the registry and reports nothing once cancelled", async () => {
    const controller = new AbortController();
    sinon.stub(command, "ExecuteFile").returns(new Promise(() => {}));
    const warnStub = sinon.stub(cliUi, "warning");

    const pending = checkOutdatedModules(packageModules(), controller.signal);
    controller.abort();

    expect(await pending).to.deep.equal([]);
    expect(warnStub.called).to.equal(false);
  });

  it("does not look anything up when cancelled before it starts", async () => {
    const controller = new AbortController();
    const execStub = sinon.stub(command, "ExecuteFile");
    controller.abort();

    const result = await checkOutdatedModules(
      packageModules(),
      controller.signal,
    );

    expect(result).to.deep.equal([]);
    expect(execStub.called).to.equal(false);
  });

  it("terminates the lookups it started and returns at once", async function () {
    if (process.platform === "win32") {
      this.skip();
    }
    sinon.stub(cliUi, "warning");
    const registryClient = await installHangingNpm();
    const controller = new AbortController();
    let lookupPid: number | undefined;

    try {
      const pending = checkOutdatedModules(packageModules(), controller.signal);
      lookupPid = await waitFor(() => readPid(registryClient.pidFile));
      const cancelledAt = Date.now();
      controller.abort();

      expect(await pending).to.deep.equal([]);
      expect(Date.now() - cancelledAt).to.be.below(CANCELLED_CHECK_BUDGET_MS);
      const startedPid = lookupPid;
      await waitFor(async () => (isRunning(startedPid) ? undefined : true));
    } finally {
      if (lookupPid !== undefined && isRunning(lookupPid)) {
        process.kill(lookupPid, "SIGKILL");
      }
      await registryClient.restore();
    }
  });
});

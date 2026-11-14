import { expect } from "chai";
import path from "node:path";
import sinon from "sinon";

import {
  commandsProjectModulesReleaseLeasesCommand as cmdReleaseLeases,
  commonModule as common,
} from "../../../../../../src/cli";
import {
  NeedsInputError,
  USAGE_EXIT_CODE,
} from "../../../../../../src/core/output";
import {
  deadPid,
  type IdleProcess,
  leaseNameOf,
  leaseNames,
  otherNamespace,
  startIdleProcess,
  thisProcess,
  writeLease,
  writeLeaseText,
} from "../../../../../helpers/cache-leases";
import { captureCliError } from "../../../../../helpers/cli-error";
import { fakePrompts } from "../../../../../helpers/fake-prompts";
import {
  createMemoryUi,
  type MemoryUi,
} from "../../../../../helpers/memory-ui";
import { cleanupTempDir, makeTempDir } from "../../../../../helpers/temp";

/** Writes the leases of a running run, an exited run, a run of another host and one of another pid namespace. */
function writeFourLeases(cachePath: string, runningPid: number): void {
  writeLease(cachePath, "running.json", {
    ...thisProcess(),
    pid: runningPid,
    entries: ["a@1.0.0"],
  });
  writeLease(cachePath, "exited.json", {
    ...thisProcess(),
    pid: deadPid(),
    entries: ["b@1.0.0"],
  });
  writeLease(cachePath, "machine.json", {
    ...thisProcess(),
    host: "elsewhere",
    pid: deadPid(),
    entries: ["c@1.0.0"],
  });
  writeLease(cachePath, "container.json", {
    ...thisProcess(),
    namespace: otherNamespace(),
    pid: deadPid(),
    entries: ["d@1.0.0"],
  });
}

/** Runs `release-leases` on the project at `project` with `flags`. */
async function release(project: string, ...flags: string[]): Promise<MemoryUi> {
  const memory = createMemoryUi();
  await cmdReleaseLeases(memory.ui).parseAsync([
    "node",
    "test",
    "--project",
    project,
    ...flags,
  ]);
  return memory;
}

describe("project modules release-leases behavior", () => {
  let root: string;
  let cachePath: string;
  let running: IdleProcess;

  beforeEach(async () => {
    root = makeTempDir("ajs-release-leases-");
    cachePath = path.join(root, "cache");
    running = await startIdleProcess();
    sinon
      .stub(common, "readConfig")
      .resolves({ name: "test-project", cacheFolder: cachePath });
  });

  afterEach(async () => {
    sinon.restore();
    await running.stop();
    cleanupTempDir(root);
  });

  it("lists every lease with its run and entries, and deletes only the leases of exited runs of this host", async () => {
    writeFourLeases(cachePath, running.pid);
    fakePrompts({ isInteractive: false });

    const { result, feedback } = await release(root);

    for (const listed of [
      "running.json running",
      "exited.json exited",
      "machine.json foreign elsewhere",
      "container.json foreign",
    ]) {
      expect(result.text.replace(/\s+/g, " ")).to.include(listed);
    }
    expect(result.text).to.include("c@1.0.0").and.include(otherNamespace());
    expect(leaseNames(cachePath)).to.deep.equal([
      "container.json",
      "machine.json",
      "running.json",
    ]);
    expect(feedback.text).to.include("Removed exited.json");
    expect(feedback.text).to.include("--foreign");
  });

  it("deletes the foreign leases too with --foreign --yes, never the lease of a running run", async () => {
    writeFourLeases(cachePath, running.pid);
    fakePrompts({ isInteractive: false });

    const { feedback } = await release(root, "--foreign", "--yes");

    expect(leaseNames(cachePath)).to.deep.equal(["running.json"]);
    expect(feedback.text)
      .to.include("Removed machine.json")
      .and.include("Removed container.json");
  });

  it("asks in a terminal before deleting foreign leases, and keeps them when the answer is no", async () => {
    writeFourLeases(cachePath, running.pid);
    const prompts = fakePrompts({ answers: [false] });

    await release(root, "--foreign");

    expect(prompts.asked.map((prompt) => prompt.kind)).to.deep.equal([
      "confirm",
    ]);
    expect(leaseNames(cachePath)).to.deep.equal([
      "container.json",
      "machine.json",
      "running.json",
    ]);
  });

  it("asks for --yes without a terminal instead of deleting foreign leases, and deletes no lease", async () => {
    writeFourLeases(cachePath, running.pid);
    fakePrompts({ isInteractive: false });

    const cliError = await captureCliError(() => release(root, "--foreign"));

    expect(cliError).to.be.instanceOf(NeedsInputError);
    expect(cliError.exitCode).to.equal(USAGE_EXIT_CODE);
    expect(cliError.problem.fixes).to.deep.equal([
      "Pass it as a flag: ajs project modules release-leases --foreign --yes",
    ]);
    expect(leaseNames(cachePath)).to.have.length(4);
  });

  it("deletes an unreadable lease whose name is an exited run of this host, and keeps one of a running run", async () => {
    const exited = leaseNameOf({ pid: deadPid() });
    const live = leaseNameOf({ pid: running.pid });
    writeLeaseText(cachePath, exited, "");
    writeLeaseText(cachePath, live, "");
    fakePrompts({ isInteractive: false });

    const { result } = await release(root);

    expect(result.text).to.include("unreadable");
    expect(leaseNames(cachePath)).to.deep.equal([live]);
  });

  it("says there is no lease when the cache has none", async () => {
    fakePrompts({ isInteractive: false });

    const { feedback } = await release(root);

    expect(feedback.text).to.include(`No leases in ${cachePath}`);
  });
});

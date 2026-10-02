import sinon from "sinon";
import { expect } from "chai";

import * as common from "../../../../../../src/core/cli/common";
import { ConfigLoader } from "../../../../../../src/core/config";
import cmdList from "../../../../../../src/core/cli/commands/project/modules/list";
import { expectProjectNotFound } from "../../../../../helpers/cli-error";
import {
  createMemoryUi,
  type MemoryUi,
} from "../../../../../helpers/memory-ui";

const PROJECT_ARGS = ["node", "test", "--project", "/tmp/project"];

const MIXED_MODULES = {
  "@scope/pkg": {
    source: { type: "package", package: "@scope/pkg", version: "1.2.3" },
  },
  aliased: {
    source: { type: "package", package: "@scope/other", version: "^2.0.0" },
  },
  gitModule: {
    source: {
      type: "git",
      remote: "https://github.com/org/repo.git",
      branch: "main",
      commit: "abcdef1234567890",
    },
  },
  bareGit: {
    source: { type: "git", remote: "https://github.com/org/bare.git" },
  },
  localModule: { source: { type: "local", path: "modules/local" } },
  folderModule: { source: { type: "local-folder", path: "modules" } },
  unknownObject: { source: { path: "/tmp/no-type" } },
  unknownString: { source: "bad-source" },
  noSource: {},
};

function stubProject(modules: Record<string, unknown>): sinon.SinonStub {
  sinon.stub(common, "readConfig").resolves({
    name: "test-project",
    environments: { staging: {} },
  } as any);
  return sinon
    .stub(ConfigLoader.prototype, "load")
    .resolves({ modules } as any);
}

async function runList(
  args: string[],
  options: { isTerminal?: boolean } = {},
): Promise<MemoryUi> {
  const memory = createMemoryUi(options);
  await cmdList(memory.ui).parseAsync([...PROJECT_ARGS, ...args]);
  return memory;
}

describe("project modules list behavior", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("fails when project config is missing", async () => {
    sinon.stub(common, "readConfig").resolves(undefined);

    await expectProjectNotFound(() =>
      cmdList(createMemoryUi().ui).parseAsync(PROJECT_ARGS),
    );
  });

  it("leaves stdout empty and suggests a command when no module is configured", async () => {
    const loadStub = stubProject({});

    const { result, feedback } = await runList([]);

    expect(loadStub.firstCall.args[1]).to.equal("default");
    expect(result.text).to.equal("");
    expect(feedback.text).to.equal(
      [
        "ℹ No modules in test-project (default)",
        "→ Add one with ajs project modules add <name>",
        "",
      ].join("\n"),
    );
  });

  it("writes one tab-separated row per module when piped", async () => {
    stubProject(MIXED_MODULES);

    const { result, feedback } = await runList(["--env", "staging"]);

    expect(result.text.split("\n")).to.deep.equal([
      "@scope/pkg\tnpm\t1.2.3",
      "aliased\tnpm\t@scope/other@^2.0.0",
      "gitModule\tgit\thttps://github.com/org/repo.git branch main commit abcdef12",
      "bareGit\tgit\thttps://github.com/org/bare.git",
      "localModule\tlocal\tmodules/local",
      "folderModule\tfolder\tmodules",
      'unknownObject\tunknown\t{"path":"/tmp/no-type"}',
      'unknownString\tunknown\t"bad-source"',
      "noSource\tunknown\t-",
      "",
    ]);
    expect(feedback.text).to.equal("ℹ 9 modules in test-project (staging)\n");
  });

  it("aligns the modules under a header on a terminal", async () => {
    stubProject({ billing: MIXED_MODULES.localModule });

    const { result, feedback } = await runList([], { isTerminal: true });

    expect(result.text.split("\n")).to.deep.equal([
      "NAME     SOURCE  REFERENCE",
      "billing  local   modules/local",
      "",
    ]);
    expect(feedback.text).to.equal("ℹ 1 module in test-project (default)\n");
  });

  it("prints the configured modules as JSON with --json", async () => {
    stubProject({ billing: MIXED_MODULES.localModule });

    const { result, feedback } = await runList(["--json"]);

    expect(JSON.parse(result.text)).to.deep.equal([
      { name: "billing", source: { type: "local", path: "modules/local" } },
    ]);
    expect(feedback.text).to.equal("");
  });

  it("prints an empty JSON array when no module is configured", async () => {
    stubProject({});

    const { result, feedback } = await runList(["--json"]);

    expect(JSON.parse(result.text)).to.deep.equal([]);
    expect(feedback.text).to.equal("");
  });
});

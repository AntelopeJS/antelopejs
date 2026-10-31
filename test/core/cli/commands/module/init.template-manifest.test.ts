import { expect } from "chai";
import { writeFileSync } from "node:fs";
import path from "node:path";
import sinon from "sinon";

import {
  gitOperationsModule as gitOps,
  moduleInitCommand,
} from "../../../../../src/cli";
import { CliError } from "../../../../../src/core/output";
import { fakePrompts } from "../../../../helpers/fake-prompts";
import type { JsonValue } from "../../../../helpers/json";
import {
  INTERFACE_CATALOG,
  stubModuleInit,
  type ModuleInitStubs,
} from "../../../../helpers/module-init-stubs";
import {
  cleanupTempDir,
  expectJsonFile,
  makeTempDir,
  readText,
} from "../../../../helpers/temp";
import { expectInstanceOf, rejectionOf } from "../../fixtures";

const API = "@antelopejs/interface-api";

describe("module init on a template's package.json", () => {
  let moduleDir: string;
  let stubs: ModuleInitStubs;

  function templateManifest(text: string): void {
    stubs.copy.callsFake(async (_template, target) => {
      writeFileSync(path.join(target, "package.json"), text);
    });
  }

  function init(interfaces: string[] = ["api"]): Promise<gitOps.Template> {
    return moduleInitCommand(moduleDir, {
      template: "basic",
      interfaces,
      yes: true,
    });
  }

  beforeEach(() => {
    moduleDir = makeTempDir();
    stubs = stubModuleInit(INTERFACE_CATALOG);
    fakePrompts({ isInteractive: false });
  });

  afterEach(() => {
    sinon.restore();
    cleanupTempDir(moduleDir);
  });

  const UNUSABLE: Array<[string, string, string]> = [
    ["dependencies is an empty array", '{"dependencies":[]}', "dependencies"],
    ["dependencies is an array", '{"dependencies":["x"]}', "dependencies"],
    ["dependencies is a string", '{"dependencies":"x"}', "dependencies"],
    ["dependencies is a number", '{"dependencies":5}', "dependencies"],
    ["dependencies is a boolean", '{"dependencies":true}', "dependencies"],
    ["the file is an empty array", "[]", "object"],
    ["the file is an array", "[1]", "object"],
    ["the file is null", "null", "object"],
    ["the file is a number", "5", "object"],
    ["the file is a string", '"x"', "object"],
  ];
  for (const [when, text, field] of UNUSABLE) {
    it(`refuses the interfaces by name, before installing, when ${when}`, async () => {
      templateManifest(text);

      const failure = await rejectionOf(init());

      expectInstanceOf(failure, CliError);
      expect(failure.problem.title).to.include("package.json");
      expect(failure.problem.reason).to.include(field);
      expect(stubs.exec.called).to.equal(false);
      expect(readText(path.join(moduleDir, "package.json"))).to.equal(text);
    });
  }

  const WRITABLE: Array<[string, string, JsonValue]> = [
    ["has no dependencies", "{}", { [API]: "latest" }],
    ["has null dependencies", '{"dependencies":null}', { [API]: "latest" }],
    ["has empty dependencies", '{"dependencies":{}}', { [API]: "latest" }],
    [
      "lists the interface with a null range",
      `{"dependencies":{"${API}":null}}`,
      { [API]: "latest" },
    ],
    [
      "lists other packages",
      '{"dependencies":{"left-pad":"^1.0.0"}}',
      { "left-pad": "^1.0.0", [API]: "latest" },
    ],
  ];
  for (const [when, text, expected] of WRITABLE) {
    it(`adds the chosen interface when the template ${when}`, async () => {
      templateManifest(text);

      await init();

      expectJsonFile(path.join(moduleDir, "package.json"))
        .to.have.property("dependencies")
        .that.deep.equals(expected);
      expect(stubs.exec.calledOnce).to.equal(true);
    });
  }

  it("keeps the order of the manifest's keys when it adds the dependencies", async () => {
    templateManifest('{"name":"t","dependencies":null,"version":"1.0.0"}');

    await init();

    expect(readText(path.join(moduleDir, "package.json"))).to.equal(
      `${JSON.stringify(
        { name: "t", dependencies: { [API]: "latest" }, version: "1.0.0" },
        null,
        2,
      )}\n`,
    );
  });

  it("leaves a manifest it cannot write into alone when no interface is chosen", async () => {
    templateManifest('{"dependencies":["x"]}');

    await init([]);

    expect(readText(path.join(moduleDir, "package.json"))).to.equal(
      '{"dependencies":["x"]}',
    );
    expect(stubs.exec.calledOnce).to.equal(true);
  });
});

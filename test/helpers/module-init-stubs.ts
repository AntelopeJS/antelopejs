import childProcess from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import sinon from "sinon";

import {
  commonModule as common,
  gitOperationsModule as gitOps,
} from "../../src/cli";
import {
  cliUiModule as cliUi,
  commandModule as command,
  packageManagerModule as pkgManager,
} from "../../src/core/output";
import { collectStderr } from "./capture-output";

const TEMPLATES: gitOps.Template[] = [
  { name: "basic", repository: "", branch: "" },
  {
    name: "api",
    repository: "",
    branch: "",
    nextSteps: [
      { command: "pnpm run setup", description: "Prepare the frontend" },
    ],
  },
];
const PROJECT_TEMPLATES: gitOps.Template[] = [
  {
    name: "dashboard",
    repository: "",
    branch: "",
    packageManager: "pnpm",
  },
];

export const INTERFACE_CATALOG = {
  api: {
    name: "api",
    folderPath: "",
    gitPath: "",
    manifest: {
      description: "HTTP API",
      package: "@antelopejs/interface-api",
      modules: [],
    },
  },
} satisfies Record<string, gitOps.InterfaceInfo>;

export interface ModuleInitStubs {
  manifest: sinon.SinonStub;
  copy: sinon.SinonStubbedMember<typeof gitOps.copyTemplate>;
  savePackageManager: sinon.SinonStub;
  getInstallCommand: sinon.SinonStub;
  exec: sinon.SinonStub;
  gitInit: sinon.SinonStub;
  spinnerFail: sinon.SinonStub;
  warning: sinon.SinonStub;
  output(): string;
}

export function stubModuleInit(
  catalog: Record<string, gitOps.InterfaceInfo> = {},
): ModuleInitStubs {
  sinon
    .stub(common, "readUserConfig")
    .resolves({ git: common.DEFAULT_GIT_REPO });
  sinon.stub(common, "displayNonDefaultGitWarning").returns();
  const manifest = sinon.stub(gitOps, "loadManifestFromGit").resolves({
    templates: TEMPLATES,
    projectTemplates: PROJECT_TEMPLATES,
    interfaces: {},
    starredInterfaces: Object.keys(catalog),
  });
  const copy = sinon
    .stub(gitOps, "copyTemplate")
    .callsFake(async (_template, target) => {
      writeFileSync(path.join(target, "package.json"), "{}");
    });
  sinon.stub(gitOps, "loadInterfacesFromGit").resolves(catalog);
  const savePackageManager = sinon
    .stub(pkgManager, "savePackageManagerToPackageJson")
    .returns();
  const getInstallCommand = sinon
    .stub(pkgManager, "getInstallCommand")
    .resolves("npm install");
  const exec = sinon
    .stub(command, "ExecuteCMD")
    .resolves({ code: 0, stdout: "", stderr: "" });
  const gitInit = sinon.stub(childProcess, "execSync");
  sinon.stub(cliUi.Spinner.prototype, "start").resolves();
  sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
  const spinnerFail = sinon.stub(cliUi.Spinner.prototype, "fail").resolves();
  const output = collectStderr();
  sinon.stub(cliUi, "info");
  sinon.stub(cliUi, "success");
  const warning = sinon.stub(cliUi, "warning");
  sinon.stub(cliUi, "error");
  sinon.stub(console, "log");
  return {
    manifest,
    copy,
    savePackageManager,
    getInstallCommand,
    exec,
    gitInit,
    spinnerFail,
    warning,
    output,
  };
}

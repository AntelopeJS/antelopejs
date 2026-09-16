import { expect } from "chai";

import { createCLI } from "../../../src/core/cli/full-cli";
import { formatOfficialPluginsHelp } from "../../../src/core/cli/plugin-registry";

function commandNames(cmd: any): string[] {
  return cmd.commands.map((c: any) => c.name()).sort();
}

describe("CLI Entry Point", () => {
  it("lists official plugins in the root help", () => {
    expect(createCLI("0.0.1").description()).to.contain(
      formatOfficialPluginsHelp(),
    );
  });

  it("should register all commands", () => {
    const program = createCLI("0.0.1");
    expect(commandNames(program)).to.include.members([
      "config",
      "module",
      "plugins",
      "project",
      "update",
    ]);

    const plugins = program.commands.find((c: any) => c.name() === "plugins");
    if (!plugins) throw new Error("plugins command missing");
    expect(plugins.aliases()).to.include("plugin");
    expect(commandNames(plugins)).to.include.members(["list"]);

    const project = program.commands.find((c: any) => c.name() === "project");
    expect(project).to.not.equal(undefined);
    if (!project) throw new Error("project command missing");

    expect(commandNames(project)).to.include.members([
      "build",
      "dev",
      "init",
      "logging",
      "modules",
      "run",
      "start",
    ]);

    const modules = project.commands.find((c: any) => c.name() === "modules");
    if (!modules) throw new Error("project modules command missing");
    expect(commandNames(modules)).to.include.members([
      "add",
      "install",
      "list",
      "remove",
      "update",
    ]);

    const logging = project.commands.find((c: any) => c.name() === "logging");
    if (!logging) throw new Error("project logging command missing");
    expect(commandNames(logging)).to.include.members(["set", "show"]);

    const mod = program.commands.find((c: any) => c.name() === "module");
    expect(mod).to.not.equal(undefined);
    if (!mod) throw new Error("module command missing");

    expect(commandNames(mod)).to.include.members(["init", "test"]);

    const config = program.commands.find((c: any) => c.name() === "config");
    expect(config).to.not.equal(undefined);
    if (!config) throw new Error("config command missing");

    expect(commandNames(config)).to.include.members([
      "get",
      "reset",
      "set",
      "show",
    ]);
  });
});

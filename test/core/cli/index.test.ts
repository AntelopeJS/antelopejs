import { expect } from "chai";
import type { Command } from "commander";

import { coreCommandNames, createCLI } from "../../../src/core/cli/full-cli";
import { formatOfficialPluginsHelp } from "../../../src/core/cli/plugin-registry";

const MAX_SUMMARY_LENGTH = 50;

function allCommands(command: Command): Command[] {
  return command.commands.flatMap((child) => [child, ...allCommands(child)]);
}

function renderHelp(command: Command): string {
  let output = "";
  command.configureOutput({
    writeOut: (text) => {
      output += text;
    },
  });
  command.outputHelp();
  return output;
}

function commandNames(cmd: any): string[] {
  return cmd.commands.map((c: any) => c.name()).sort();
}

describe("CLI Entry Point", () => {
  it("derives the never-delegated command names from the program", () => {
    const names = coreCommandNames(createCLI("0.0.1"));

    expect(names).to.include.members([
      "config",
      "help",
      "module",
      "plugin",
      "plugins",
      "project",
      "update",
    ]);
  });

  it("lists official plugins, examples and the docs after the root commands", () => {
    const help = renderHelp(createCLI("0.0.1"));

    expect(help).to.contain(formatOfficialPluginsHelp());
    expect(help).to.contain("$ ajs project dev --watch");
    expect(help).to.contain("Docs: https://antelopejs.com/docs/cli");
    expect(help.indexOf("Commands:")).to.be.below(help.indexOf("Plugins:"));
  });

  it("lists each root command once, with its summary", () => {
    const help = renderHelp(createCLI("0.0.1"));

    expect(help.match(/^ {2}project\b/gm)).to.have.length(1);
    expect(help).to.not.contain("project run");
  });

  it("gives every command a short one-line summary", () => {
    allCommands(createCLI("0.0.1")).forEach((command) => {
      const summary = command.summary();
      expect(summary, command.name()).to.match(/^[A-Z][^\n]*[^.]$/);
      expect(summary.length, summary).to.be.at.most(MAX_SUMMARY_LENGTH);
      expect(command.description(), command.name()).to.not.contain("\n");
    });
  });

  it("shows examples on the help page of every command without subcommands", () => {
    allCommands(createCLI("0.0.1"))
      .filter((command) => command.commands.length === 0)
      .forEach((command) =>
        expect(renderHelp(command), command.name()).to.contain("Examples:"),
      );
  });

  it("never prints the current directory as a default", () => {
    allCommands(createCLI("0.0.1")).forEach((command) =>
      expect(renderHelp(command), command.name()).to.not.contain(process.cwd()),
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

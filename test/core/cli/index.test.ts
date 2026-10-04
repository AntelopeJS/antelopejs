import sinon from "sinon";
import { expect } from "chai";
import type { Command } from "commander";

import { coreCommandNames, createCLI } from "../../../src/core/cli/full-cli";
import {
  CliError,
  normalizeVerboseArguments,
} from "../../../src/core/cli/output";
import { formatUsageErrors } from "../../../src/core/cli/usage-errors";
import { USAGE_EXIT_CODE } from "../../../src/core/cli/exit-codes";
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

interface VerboseParse {
  hasRunDev: boolean;
  verbose: unknown;
}

function findCommand(command: Command, name: string): Command {
  const found = command.commands.find((child) => child.name() === name);
  if (!found) {
    throw new Error(`No command ${name}`);
  }
  return found;
}

async function parseDev(args: string[]): Promise<VerboseParse> {
  const program = createCLI("0.0.1");
  formatUsageErrors(program);
  const devAction = sinon.stub();
  findCommand(findCommand(program, "project"), "dev").action(devAction);
  await program.parseAsync(normalizeVerboseArguments(args), { from: "user" });
  return {
    hasRunDev: devAction.called,
    verbose: program.getOptionValue("verbose"),
  };
}

describe("CLI --verbose parsing", () => {
  const MATRIX: [string[], string[]][] = [
    [["--verbose", "project", "dev"], ["*"]],
    [["project", "dev", "--verbose"], ["*"]],
    [["--verbose", "--no-color", "project", "dev"], ["*"]],
    [
      ["--verbose=loader,cli", "project", "dev"],
      ["loader", "cli"],
    ],
    [["project", "dev", "--verbose=resolution.%"], ["resolution.*"]],
  ];

  MATRIX.forEach(([args, channels]) =>
    it(`runs project dev for ${args.join(" ")}`, async () => {
      expect(await parseDev(args)).to.deep.equal({
        hasRunDev: true,
        verbose: channels,
      });
    }),
  );

  it("never reads the argument after a bare --verbose as channels", async () => {
    const failure = await parseDev(["project", "dev", "--verbose", "loader"])
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(failure).to.be.instanceOf(CliError);
    expect((failure as CliError).exitCode).to.equal(USAGE_EXIT_CODE);
    expect((failure as CliError).message).to.match(/too many arguments/i);
  });
});

interface TerminalState {
  isTTY?: boolean;
  columns?: number;
}

describe("CLI root help width", () => {
  const original: TerminalState = {
    isTTY: process.stdout.isTTY,
    columns: process.stdout.columns,
  };

  function useTerminal(columns: number): void {
    Object.assign(process.stdout, { isTTY: true, columns });
  }

  afterEach(() => Object.assign(process.stdout, original));

  const UNBREAKABLE_LINE = /^ {2}\$ |https:\/\//;

  function overflowingLines(help: string, columns: number): string[] {
    return help
      .split("\n")
      .filter((line) => line.length > columns)
      .filter((line) => !UNBREAKABLE_LINE.test(line));
  }

  [80, 60, 40].forEach((columns) =>
    it(`fits the root help in a ${columns}-column terminal, commands and links whole`, () => {
      useTerminal(columns);

      const help = renderHelp(createCLI("0.0.1"));

      expect(overflowingLines(help, columns)).to.deep.equal([]);
      expect(help).to.contain("  $ ajs project modules add @antelopejs/api\n");
    }),
  );

  it("wraps descriptions beside their term and the footer at 60 columns", () => {
    useTerminal(60);

    const help = renderHelp(createCLI("0.0.1"));

    expect(help).to.contain(
      "  --verbose [=channels]     Print TRACE logs and full error\n" +
        "                            details, optionally for some log\n",
    );
    expect(help).to.contain(
      "  dms        DMS frontend commands\n             (@antelopejs/dms-frontend)\n",
    );
    expect(help).to.contain(
      "Run ajs <command> --help for details.\nDocs: https://antelopejs.com/docs/cli/introduction",
    );
  });

  it("stacks descriptions under their term at 40 columns", () => {
    useTerminal(40);

    expect(renderHelp(createCLI("0.0.1"))).to.contain(
      "  --verbose [=channels]\n      Print TRACE logs and full error\n",
    );
  });
});

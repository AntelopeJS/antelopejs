import { expect } from "chai";
import { Command } from "commander";

import {
  applyHelpConventions,
  formatExamples,
  formatHelpItem,
  helpTextWidth,
  helpWidth,
  withExamples,
} from "../../../src/core/cli/help";
import { unbreakable, wrapText } from "../../../src/core/cli/output/format";

const EXAMPLES = [
  { description: "Create a project", command: "ajs project init my-app" },
  { description: "Accept every default", command: "ajs project init a --yes" },
];

const BACKEND_DESCRIPTION =
  "Backend URL; when omitted, discovered from the enclosing project's .antelope/dev.json";

function renderHelp(command: Command, width?: number): string {
  let output = "";
  command.configureOutput({
    writeOut: (text) => {
      output += text;
    },
  });
  if (width !== undefined) {
    command.configureOutput({ getOutHelpWidth: () => width });
  }
  command.outputHelp();
  return output;
}

function devCommand(): Command {
  const dev = new Command("dev")
    .description("Run the project")
    .option("-b, --backend-url <url>", BACKEND_DESCRIPTION);
  applyHelpConventions(dev);
  return dev;
}

function longestLine(text: string): number {
  return Math.max(...text.split("\n").map((line) => line.length));
}

describe("CLI help conventions", () => {
  it("renders each example as a comment followed by the command", () => {
    expect(formatExamples(EXAMPLES).split("\n")).to.deep.equal([
      "Examples:",
      "  # Create a project",
      "  $ ajs project init my-app",
      "  # Accept every default",
      "  $ ajs project init a --yes",
    ]);
  });

  it("appends the examples to the help page of the command", () => {
    const command = withExamples(new Command("init"), EXAMPLES);

    expect(renderHelp(command).trimEnd()).to.match(
      /\n\nExamples:\n {2}# Create a project\n[^]*init a --yes$/,
    );
  });

  it("words --help and the help command the same on every command", () => {
    const leaf = new Command("leaf");
    const group = new Command("group").addCommand(leaf);
    const root = new Command("root").addCommand(group);

    applyHelpConventions(root);

    [root, group, leaf].forEach((command) =>
      expect(command.helpInformation()).to.match(
        /-h, --help +Show help for a command/,
      ),
    );
    expect(group.helpInformation()).to.match(
      /help \[command\] +Show help for a command/,
    );
    expect(leaf.helpInformation()).to.not.include("help [command]");
  });

  it("lists the options of the parent commands on every help page", () => {
    const leaf = new Command("leaf");
    const root = new Command("root")
      .option("--verbose", "Print more")
      .addCommand(leaf);

    applyHelpConventions(root);

    expect(leaf.helpInformation()).to.match(
      /Global Options:\n {2}--verbose +Print more/,
    );
  });
});

describe("CLI help width", () => {
  it("follows the terminal up to 80 columns, and is 80 columns in a pipe", () => {
    expect(helpWidth({ isTTY: true, columns: 60 })).to.equal(60);
    expect(helpWidth({ isTTY: true, columns: 200 })).to.equal(80);
    expect(helpWidth({ isTTY: true })).to.equal(80);
    expect(helpWidth({ isTTY: false, columns: 60 })).to.equal(80);
  });

  it("wraps a help page to the stream it is written to", () => {
    const original = process.stderr.columns;
    const isTerminal = process.stderr.isTTY;
    Object.assign(process.stderr, { isTTY: true, columns: 50 });
    try {
      const command = new Command("dev");
      expect(helpTextWidth({ error: true, command })).to.equal(50);
      expect(helpTextWidth({ error: false, command })).to.equal(
        helpWidth(process.stdout),
      );
    } finally {
      Object.assign(process.stderr, { isTTY: isTerminal, columns: original });
    }
  });

  it("wraps text between words, keeping long and unbreakable words whole", () => {
    expect(wrapText("Run the project and reload it", 12)).to.deep.equal([
      "Run the",
      "project and",
      "reload it",
    ]);
    expect(wrapText("See https://antelopejs.com/docs/cli", 10)).to.deep.equal([
      "See",
      "https://antelopejs.com/docs/cli",
    ]);
    expect(
      wrapText(`Run ${unbreakable("ajs <command> --help")} now`, 12),
    ).to.deep.equal(["Run", "ajs <command> --help", "now"]);
    expect(wrapText("First line\nsecond", 40)).to.deep.equal([
      "First line",
      "second",
    ]);
  });

  it("puts a description beside its term while 30 columns are left", () => {
    expect(formatHelpItem("dms", 9, BACKEND_DESCRIPTION, 50)).to.deep.equal([
      "  dms        Backend URL; when omitted, discovered",
      "             from the enclosing project's",
      "             .antelope/dev.json",
    ]);
  });

  it("puts a description under its term when fewer columns are left", () => {
    expect(formatHelpItem("dms", 9, BACKEND_DESCRIPTION, 40)).to.deep.equal([
      "  dms",
      "      Backend URL; when omitted,",
      "      discovered from the enclosing",
      "      project's .antelope/dev.json",
    ]);
    expect(formatHelpItem("dms", 9, "", 40)).to.deep.equal(["  dms"]);
  });

  it("keeps an 80-column help page on one line per option", () => {
    expect(renderHelp(devCommand(), 80)).to.include(
      `  -b, --backend-url <url>  ${BACKEND_DESCRIPTION.slice(0, 20)}`,
    );
  });

  [64, 60, 40].forEach((width) =>
    it(`fits a help page in ${width} columns`, () => {
      const help = renderHelp(devCommand(), width);

      expect(longestLine(help)).to.be.at.most(width);
      expect(help).to.include("Backend URL;");
    }),
  );

  it("wraps descriptions beside their option on a 64-column terminal", () => {
    expect(renderHelp(devCommand(), 64)).to.include(
      "  -b, --backend-url <url>  Backend URL; when omitted, discovered\n" +
        "                           from the enclosing project's",
    );
  });

  it("stacks descriptions under their option on a 40-column terminal", () => {
    expect(renderHelp(devCommand(), 40)).to.include(
      "  -b, --backend-url <url>\n      Backend URL; when omitted,\n",
    );
  });

  it("wraps the comment of an example, never its command", () => {
    const examples = [
      {
        description: "Add a module from npm and pin its version",
        command: "ajs project modules add @antelopejs/api@1.2.3",
      },
    ];

    expect(formatExamples(examples, 30).split("\n")).to.deep.equal([
      "Examples:",
      "  # Add a module from npm and",
      "  # pin its version",
      "  $ ajs project modules add @antelopejs/api@1.2.3",
    ]);
  });
});

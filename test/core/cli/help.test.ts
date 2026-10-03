import { expect } from "chai";
import { Command } from "commander";

import {
  applyHelpConventions,
  formatExamples,
  withExamples,
} from "../../../src/core/cli/help";

const EXAMPLES = [
  { description: "Create a project", command: "ajs project init my-app" },
  { description: "Accept every default", command: "ajs project init a --yes" },
];

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

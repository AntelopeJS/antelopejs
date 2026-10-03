import { Command, Option } from "commander";

import { Options } from "../../options";
import { withExamples } from "../../help";
import { lazyAction } from "../../lazy-action";

export default function () {
  const command = new Command("init")
    .summary("Create a project")
    .description(
      "Create a project folder with an antelope.config.ts file and its first module, either imported from npm, git or a local path, or created from a template. Every question can be answered with a flag, so the command also runs in scripts and CI.",
    )
    .argument("<project>", "Directory of the new project")
    .addOption(
      new Option(
        "--name <name>",
        "Name of the project (default: the directory name)",
      ),
    )
    .addOption(Options.template)
    .addOption(Options.interfaces)
    .addOption(Options.packageManager)
    .addOption(Options.gitInit)
    .addOption(Options.noGitInit)
    .addOption(Options.yes)
    .action(
      lazyAction(
        async () => (await import("./init-action")).projectInitCommand,
      ),
    );
  return withExamples(command, [
    {
      description: "Answer the questions interactively",
      command: "ajs project init my-app",
    },
    {
      description: "Accept every default",
      command: "ajs project init my-app --yes",
    },
    {
      description: "Answer every question with a flag, for scripts and CI",
      command:
        'ajs project init my-app --template "Blank Typescript" --pm pnpm --no-git-init',
    },
  ]);
}

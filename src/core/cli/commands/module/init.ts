import { Command } from "commander";

import { Options } from "../../options";
import { withExamples } from "../../help";
import { lazyAction } from "../../lazy-action";

export default function () {
  const command = new Command("init")
    .summary("Create a module from a template")
    .description(
      "Create a module from one of the templates of the interface repository, with the interfaces it depends on, its package manager and an optional git repository. Every question can be answered with a flag, so the command also runs in scripts and CI.",
    )
    .argument("<path>", "Directory of the new module")
    .addOption(Options.git)
    .addOption(Options.template)
    .addOption(Options.interfaces)
    .addOption(Options.packageManager)
    .addOption(Options.gitInit)
    .addOption(Options.noGitInit)
    .addOption(Options.yes)
    .action(
      lazyAction(async () => (await import("./init-action")).runModuleInit),
    );
  return withExamples(command, [
    {
      description: "Answer the questions interactively",
      command: "ajs module init ./modules/my-module",
    },
    {
      description: "Accept every default",
      command: "ajs module init ./modules/my-module --yes",
    },
    {
      description: "Answer every question with a flag, for scripts and CI",
      command:
        'ajs module init ./modules/my-module --template "Blank Typescript" --pm pnpm --no-git-init',
    },
  ]);
}

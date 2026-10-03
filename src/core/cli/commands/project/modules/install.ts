import { Command, Option } from "commander";

import { Options } from "../../../options";
import { withExamples } from "../../../help";
import { lazyAction } from "../../../lazy-action";

export default function () {
  const command = new Command("install")
    .summary("Add modules for unresolved interfaces")
    .description(
      "Find the interfaces the modules of the project import but no module implements, and add a module that implements each of them, taken from the interface repository. An interface implemented by a single module gets that module without a question.",
    )
    .addOption(Options.project)
    .addOption(Options.env)
    .addOption(Options.git)
    .addOption(
      new Option(
        "-y, --yes",
        "Add the first module listed when several implement an interface",
      ),
    )
    .action(
      lazyAction(async () => (await import("./install-action")).installModules),
    );
  return withExamples(command, [
    {
      description: "Add the missing modules, asking when there is a choice",
      command: "ajs project modules install",
    },
    {
      description: "Never ask, for scripts and CI",
      command: "ajs project modules install --yes",
    },
  ]);
}

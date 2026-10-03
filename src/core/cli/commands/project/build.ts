import { Command } from "commander";

import { Options } from "../../options";
import { withExamples } from "../../help";
import { lazyAction } from "../../lazy-action";

export default function () {
  const command = new Command("build")
    .summary("Build the project for production")
    .description(
      "Download and install the modules of the project, check that every module loads, and write the build artifact .antelope/build/build.json that ajs project start launches.",
    )
    .addOption(Options.project)
    .addOption(Options.env)
    .action(lazyAction(async () => (await import("./build-action")).runBuild));
  return withExamples(command, [
    {
      description: "Build the production environment",
      command: "ajs project build -e production",
    },
  ]);
}

import { Command, Option } from "commander";

import { Options } from "../../options";
import { withExamples } from "../../help";
import { lazyAction } from "../../lazy-action";

export default function () {
  const command = new Command("start")
    .summary("Start the project from its build")
    .description(
      "Start the project from the build artifact .antelope/build/build.json, without downloading modules or loading the development CLI. Run ajs project build first.",
    )
    .addOption(Options.project)
    .addOption(Options.env)
    .addOption(
      new Option(
        "-c, --concurrency <number>",
        "Number of modules to load concurrently",
      ).argParser(parseInt),
    )
    .addOption(
      new Option(
        "--refresh-config",
        "Resolve antelope.config.ts for the environment instead of using the build configuration (exit code 3 when the module set differs from the build)",
      ),
    )
    .action(lazyAction(async () => (await import("./start-action")).runStart));
  return withExamples(command, [
    {
      description: "Start the production build",
      command: "ajs project start -e production",
    },
    {
      description: "Start with the configuration of the current environment",
      command: "ajs project start -e production --refresh-config",
    },
  ]);
}

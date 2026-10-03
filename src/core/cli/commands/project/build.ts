import { Command, Option } from "commander";

import { Options } from "../../options";
import { lazyAction } from "../../lazy-action";

export default function () {
  return new Command("build")
    .description(
      `Build your AntelopeJS project\n` +
        `Downloads modules, validates the module graph, and writes a build artifact for fast production startup.`,
    )
    .addOption(Options.project)
    .addOption(Options.verbose)
    .addOption(
      new Option(
        "-e, --env <environment>",
        "Environment to use for build validation",
      ).env("ANTELOPEJS_LAUNCH_ENV"),
    )
    .action(lazyAction(async () => (await import("./build-action")).runBuild));
}

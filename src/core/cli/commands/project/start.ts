import { Command, Option } from "commander";

import { Options } from "../../options";
import { lazyAction } from "../../lazy-action";

export default function () {
  return new Command("start")
    .description(
      `Start your AntelopeJS project from build artifacts\n` +
        `Skips module download and graph validation by launching from .antelope/build/build.json.`,
    )
    .addOption(Options.project)
    .addOption(Options.verbose)
    .addOption(
      new Option(
        "-e, --env <environment>",
        "Runtime environment (the build configuration is reused unless --refresh-config is set)",
      ).env("ANTELOPEJS_LAUNCH_ENV"),
    )
    .addOption(
      new Option(
        "-c, --concurrency <number>",
        "Number of modules to load concurrently",
      ).argParser(parseInt),
    )
    .addOption(
      new Option(
        "--refresh-config",
        "Start with antelope.config.ts resolved for the environment instead of the build configuration (exits with code 3 when the module set differs from the build)",
      ),
    )
    .action(lazyAction(async () => (await import("./start-action")).runStart));
}

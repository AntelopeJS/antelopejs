import chalk from "chalk";
import { Command, Option } from "commander";

import { Options } from "../../common";
import { displayBox, error, info } from "../../cli-ui";
import { startFailureExitCode, startFromBuild } from "../../production-start";
import { type BuildLaunchOptions, DEFAULT_ENV } from "../../../..";
import {
  type ProjectCommandOptions,
  resolveInheritedVerbose,
  validateProjectExists,
} from "../shared/project-command";

interface StartCommandOptions
  extends ProjectCommandOptions, BuildLaunchOptions {
  project: string;
}
const DISABLED_LABEL = "disabled";

function normalizeOptions(
  command: Command,
  options: StartCommandOptions,
): StartCommandOptions {
  return {
    ...options,
    verbose: resolveInheritedVerbose(command, options.verbose),
  };
}

async function showStartConfiguration(
  options: StartCommandOptions,
): Promise<void> {
  const concurrency = options.concurrency?.toString() ?? DISABLED_LABEL;
  await displayBox(
    `Environment: ${chalk.cyan(options.env ?? DEFAULT_ENV)}\n` +
      `Project: ${chalk.cyan(options.project)}\n` +
      `Concurrency: ${options.concurrency ? chalk.green(concurrency) : chalk.gray(concurrency)}`,
    " Start Configuration",
    { padding: 1 },
  );
}

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
    .action(async function (this: Command, options: StartCommandOptions) {
      const commandOptions = normalizeOptions(this, options);
      console.log("");

      const hasProject = await validateProjectExists(commandOptions.project);
      if (!hasProject) {
        return;
      }

      console.log("");
      await showStartConfiguration(commandOptions);

      console.log("");
      info(`Starting AntelopeJS project from build artifact`);

      try {
        await startFromBuild({
          project: commandOptions.project,
          env: commandOptions.env ?? DEFAULT_ENV,
          concurrency: commandOptions.concurrency,
          verbose: commandOptions.verbose,
          refreshConfig: commandOptions.refreshConfig ?? false,
          help: false,
        });
      } catch (err) {
        error(err instanceof Error ? err : String(err));
        process.exitCode = startFailureExitCode(err);
      }
    });
}

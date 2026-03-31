import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";
import chalk from "chalk";
import { Command, Option } from "commander";
import { ConfigLoader } from "../../../../config";
import { NodeFileSystem } from "../../../../filesystem";
import {
  checkOutdatedModules,
  type OutdatedModule,
} from "../../../../version-checker";
import { error as errorUI, info, success, warning } from "../../../cli-ui";
import { Options, readConfig, writeConfig } from "../../../common";

interface UpdateOptions {
  project: string;
  env?: string;
  dryRun: boolean;
}

function applyUpdates(
  env: Record<string, unknown>,
  outdated: OutdatedModule[],
  antelopeModules: Record<string, { source?: { type: string } }>,
): void {
  const envModules = (env as { modules: Record<string, unknown> }).modules;
  for (const entry of outdated) {
    envModules[entry.name] = {
      ...antelopeModules[entry.name],
      source: {
        ...(antelopeModules[entry.name].source as ModuleSourcePackage),
        version: entry.latest,
      } as ModuleSourcePackage,
    };
  }
}

function displayResults(
  outdated: OutdatedModule[],
  options: UpdateOptions,
  notFound: string[],
): void {
  if (options.dryRun) {
    warning(chalk.yellow`Dry run - no changes were made`);
  }

  if (outdated.length > 0) {
    const label = options.dryRun ? "Would update" : "Updated";
    success(chalk.green`${label} ${outdated.length} module(s):`);
    for (const entry of outdated) {
      info(
        `  ${chalk.green("•")} ${entry.name}: ${chalk.dim(entry.current)} → ${entry.latest}`,
      );
    }
  } else {
    success(chalk.green`All modules are up to date!`);
  }

  if (notFound.length > 0) {
    warning(chalk.yellow`${notFound.length} module(s) not found in project:`);
    for (const name of notFound) {
      info(`  ${chalk.yellow("•")} ${chalk.bold(name)}`);
    }
  }

  if (outdated.length > 0 && !options.dryRun) {
    info(`Run ${chalk.bold("ajs project run")} to use the updated modules.`);
  }
}

export default function () {
  return new Command("update")
    .description(
      `Update modules to latest versions\n` +
        `Checks for and applies module updates from npm`,
    )
    .argument("[modules...]", "Specific modules to update (default: all)")
    .addOption(Options.project)
    .addOption(
      new Option(
        "-e, --env <environment>",
        "Environment to update modules in",
      ).env("ANTELOPEJS_LAUNCH_ENV"),
    )
    .addOption(
      new Option(
        "--dry-run",
        "Show what would be updated without making changes",
      ).default(false),
    )
    .action(async (modules: string[], options: UpdateOptions) => {
      info(chalk.blue`Checking for module updates...`);

      const config = await readConfig(options.project);
      if (!config) {
        errorUI(
          chalk.red`No project configuration found at: ${options.project}`,
        );
        info(
          `Make sure you're in an AntelopeJS project or use the --project option.`,
        );
        process.exitCode = 1;
        return;
      }

      const env = options.env ? config?.environments?.[options.env] : config;
      if (!env) {
        errorUI(
          chalk.red`Environment ${options.env || "default"} not found in project config`,
        );
        process.exitCode = 1;
        return;
      }

      if (!env.modules || Object.keys(env.modules).length === 0) {
        errorUI(chalk.red`No modules installed in this environment`);
        return;
      }

      const loader = new ConfigLoader(new NodeFileSystem());
      const antelopeConfig = await loader.load(
        options.project,
        options.env || "default",
      );

      let outdated = await checkOutdatedModules(antelopeConfig.modules);
      let notFound: string[] = [];

      if (modules.length > 0) {
        const requestedSet = new Set(modules);
        notFound = modules.filter((m) => !antelopeConfig.modules[m]);
        outdated = outdated.filter((entry) => requestedSet.has(entry.name));
      }

      if (outdated.length > 0 && !options.dryRun) {
        applyUpdates(
          env as unknown as Record<string, unknown>,
          outdated,
          antelopeConfig.modules,
        );
        await writeConfig(options.project, config);
      }

      displayResults(outdated, options, notFound);
    });
}

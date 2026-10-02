import chalk from "chalk";
import { Command, Option } from "commander";
import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";

import { ConfigLoader } from "../../../../config";
import { FAILURE_EXIT_CODE } from "../../../exit-codes";
import type { ExpandedModuleConfig } from "../../../../config/config-parser";
import { NodeFileSystem } from "../../../../filesystem";
import { Options, readConfig, writeConfig } from "../../../common";
import { error as errorUI, info, success, warning } from "../../../cli-ui";
import {
  bumpVersionSpec,
  checkOutdatedModules,
  type OutdatedModule,
} from "../../../../version-checker";

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
        version: bumpVersionSpec(entry.current, entry.latest),
      } as ModuleSourcePackage,
    };
  }
}

function displayResults(
  outdated: OutdatedModule[],
  options: UpdateOptions,
): void {
  if (options.dryRun) {
    warning(chalk.yellow`Dry run - no changes were made`);
  }

  if (outdated.length > 0) {
    const label = options.dryRun ? "Would update" : "Updated";
    success(chalk.green`${label} ${outdated.length} module(s):`);
    for (const entry of outdated) {
      info(
        `  ${chalk.green("•")} ${entry.name}: ${chalk.dim(entry.current)} → ${bumpVersionSpec(entry.current, entry.latest)}`,
      );
    }
  } else {
    success(chalk.green`All modules are up to date!`);
  }

  if (outdated.length > 0 && !options.dryRun) {
    info(`Run ${chalk.bold("ajs project run")} to use the updated modules.`);
  }
}

function selectRequestedModules(
  projectModules: Record<string, ExpandedModuleConfig>,
  requested: string[],
): Record<string, ExpandedModuleConfig> | undefined {
  if (requested.length === 0) {
    return projectModules;
  }
  const notFound = requested.filter((name) => !projectModules[name]);
  if (notFound.length > 0) {
    errorUI(
      chalk.red`The following modules are not present in the project: ${notFound
        .map((name) => chalk.bold(name))
        .join(", ")}`,
    );
    info(
      `Available modules: ${Object.keys(projectModules)
        .map((name) => chalk.bold(name))
        .join(", ")}`,
    );
    process.exitCode = FAILURE_EXIT_CODE;
    return undefined;
  }
  return Object.fromEntries(
    requested.map((name) => [name, projectModules[name]]),
  );
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
        process.exitCode = FAILURE_EXIT_CODE;
        return;
      }

      const env = options.env ? config?.environments?.[options.env] : config;
      if (!env) {
        errorUI(
          chalk.red`Environment ${options.env || "default"} not found in project config`,
        );
        process.exitCode = FAILURE_EXIT_CODE;
        return;
      }

      if (!env.modules || Object.keys(env.modules).length === 0) {
        errorUI(chalk.red`No modules installed in this environment`);
        process.exitCode = FAILURE_EXIT_CODE;
        return;
      }

      const loader = new ConfigLoader(new NodeFileSystem());
      const antelopeConfig = await loader.load(
        options.project,
        options.env || "default",
      );

      const selectedModules = selectRequestedModules(
        antelopeConfig.modules,
        modules,
      );
      if (!selectedModules) {
        return;
      }

      const outdated = await checkOutdatedModules(selectedModules);

      if (outdated.length > 0 && !options.dryRun) {
        applyUpdates(
          env as unknown as Record<string, unknown>,
          outdated,
          antelopeConfig.modules,
        );
        await writeConfig(options.project, config);
      }

      displayResults(outdated, options);
    });
}

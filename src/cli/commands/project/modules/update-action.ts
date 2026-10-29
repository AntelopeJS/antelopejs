import type {
  AntelopeConfig,
  ModuleSource,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";

import type { ExpandedModuleConfig } from "../../../../core/config";
import { ConfigLoader, TS_CONFIG_FILE } from "../../../../core/config";
import { NodeFileSystem } from "../../../../core/filesystem";
import {
  bumpVersionSpec,
  checkOutdatedModules,
  type OutdatedModule,
} from "../../../../core/modules";
import {
  error as errorUI,
  FAILURE_EXIT_CODE,
  getProcessUi,
  info,
  pluralize,
  type NextStep,
} from "../../../../core/output";
import { writeConfig } from "../../../common";
import { formatNames } from "../../shared/names";
import {
  type LockedModule,
  pruneModuleLocks,
  refreshModuleLocks,
} from "./module-locks";
import { scopedCommand } from "../../shared/next-steps";
import { resolveProjectContext } from "../../shared/project-command";

interface UpdateOptions {
  project: string;
  env?: string;
  dryRun: boolean;
}

const PACKAGE_SOURCE_TYPE = "package";

function isPackageSource(source: ModuleSource): source is ModuleSourcePackage {
  return source.type === PACKAGE_SOURCE_TYPE;
}

function applyUpdates(
  envModules: NonNullable<AntelopeConfig["modules"]>,
  outdated: OutdatedModule[],
  antelopeModules: Record<string, ExpandedModuleConfig>,
): void {
  for (const entry of outdated) {
    const { source } = antelopeModules[entry.name];
    if (!isPackageSource(source)) {
      continue;
    }
    envModules[entry.name] = {
      ...antelopeModules[entry.name],
      source: {
        ...source,
        version: bumpVersionSpec(entry.current, entry.latest),
      },
    };
  }
}
/**
 * The package modules of `selected`, at the version `modules update` moves
 * them to.
 */
function lockedModules(
  selected: Record<string, ExpandedModuleConfig>,
  outdated: OutdatedModule[],
): LockedModule[] {
  return Object.entries(selected).flatMap(([id, { source }]) => {
    if (!isPackageSource(source)) {
      return [];
    }
    const update = outdated.find((entry) => entry.name === id);
    const version = update
      ? bumpVersionSpec(update.current, update.latest)
      : source.version;
    return [{ id, source: { ...source, version } }];
  });
}

const UPDATE_COMMAND = "ajs project modules update";
const DEV_COMMAND = "ajs project dev";

interface UpdateReport {
  modules: string[];
  outdated: OutdatedModule[];
  checkedCount: number;
  options: UpdateOptions;
  durationMs: number;
}

function countPackageModules(
  modules: Record<string, ExpandedModuleConfig>,
): number {
  return Object.values(modules).filter(
    (module) => module.source?.type === PACKAGE_SOURCE_TYPE,
  ).length;
}

function updateHeadline(report: UpdateReport): string {
  const count = pluralize(report.outdated.length, "module");
  if (report.outdated.length > 0) {
    const { separator } = getProcessUi().symbols;
    return report.options.dryRun
      ? `Dry run: ${count} can be updated${separator}${TS_CONFIG_FILE} unchanged`
      : `${count} updated in ${TS_CONFIG_FILE}`;
  }
  if (report.checkedCount === 0) {
    return "Nothing to update: no module comes from npm";
  }
  return `Everything is up to date (${pluralize(report.checkedCount, "npm module")} checked)`;
}

function updateNextSteps(report: UpdateReport): NextStep[] {
  if (report.outdated.length === 0) {
    return [];
  }
  if (report.options.dryRun) {
    const command = [UPDATE_COMMAND, ...report.modules].join(" ");
    return [
      {
        command: scopedCommand(command, report.options),
        description: "apply these updates",
      },
    ];
  }
  return [
    {
      command: scopedCommand(DEV_COMMAND, report.options),
      description: "run the project with the new versions",
    },
  ];
}

function displayResults(report: UpdateReport): void {
  const ui = getProcessUi();
  const level = report.options.dryRun ? "info" : "success";
  const verb = report.options.dryRun ? "Would update" : "Updated";
  const palette = ui.palette();
  report.outdated.forEach((entry) =>
    ui.message(
      level,
      `${verb} ${palette.bold(entry.name)} ${palette.dim(entry.current)} ${ui.symbols.arrow} ${bumpVersionSpec(entry.current, entry.latest)}`,
    ),
  );
  ui.summary({
    headline: updateHeadline(report),
    durationMs: report.durationMs,
    nextSteps: updateNextSteps(report),
  });
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
      `The following modules are not present in the project: ${formatNames(notFound)}`,
    );
    info(`Available modules: ${formatNames(Object.keys(projectModules))}`);
    process.exitCode = FAILURE_EXIT_CODE;
    return undefined;
  }
  return Object.fromEntries(
    requested.map((name) => [name, projectModules[name]]),
  );
}

export async function updateModules(
  modules: string[],
  options: UpdateOptions,
): Promise<void> {
  const startedAt = Date.now();
  const {
    config,
    environment,
    environmentConfig: env,
  } = await resolveProjectContext(options.project, options.env);

  if (!env.modules || Object.keys(env.modules).length === 0) {
    errorUI("No modules installed in this environment");
    process.exitCode = FAILURE_EXIT_CODE;
    return;
  }

  const loader = new ConfigLoader(new NodeFileSystem());
  const antelopeConfig = await loader.load(options.project, environment);
  const selectedModules = selectRequestedModules(
    antelopeConfig.modules,
    modules,
  );
  if (!selectedModules) {
    return;
  }

  const outdated = await checkOutdatedModules(selectedModules);
  if (!options.dryRun) {
    await refreshModuleLocks(
      options.project,
      config,
      lockedModules(selectedModules, outdated),
    );
    if (outdated.length > 0) {
      applyUpdates(env.modules, outdated, antelopeConfig.modules);
      await writeConfig(options.project, config);
    }
    await pruneModuleLocks(options.project, config);
  }
  displayResults({
    modules,
    outdated,
    checkedCount: countPackageModules(selectedModules),
    options,
    durationMs: Date.now() - startedAt,
  });
}

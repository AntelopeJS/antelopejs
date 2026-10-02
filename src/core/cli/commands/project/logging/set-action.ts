import chalk from "chalk";
import inquirer from "inquirer";

import { defaultConfigLogging } from "../../../../../logging";
import { writeConfig } from "../../../common";
import { displayBox, info, success, warning } from "../../../cli-ui";
import { resolveProjectContext } from "../../shared/project-command";
import {
  applyLoggingChanges,
  LoggingDraft,
  ModuleTrackingDraft,
  resolveLoggingDraft,
} from "./logging-draft";
import {
  applySetOptions,
  FORMATTER_LEVELS,
  formatterKeyOf,
  OperationResult,
  SetOptions,
} from "./set-operations";
import { assertSetUsage, isInteractiveRun } from "./set-usage";

type TrackingMode = "all" | "whitelist" | "blacklist";
type TrackingModeHandler = (tracking: ModuleTrackingDraft) => Promise<void>;

const NOTHING_TO_CHANGE = "Nothing to change";
const UNCHANGED_CONFIGURATION =
  "the logging configuration already has these settings";
const SUMMARY_RULE_WIDTH = 40;

export async function runSet(options: SetOptions): Promise<void> {
  assertSetUsage(options);
  const { config, environmentConfig } = await resolveProjectContext(
    options.project,
    options.env,
  );
  console.log("");

  const before = resolveLoggingDraft(config, environmentConfig);
  const after = structuredClone(before);
  const results = await collectChanges(after, options, config.name);

  if (!applyLoggingChanges(environmentConfig, before, after)) {
    reportNothingToChange(results);
    return;
  }
  await writeConfig(options.project, config);
  await reportSaved(results, projectLabel(config.name, options.env));
}

async function collectChanges(
  logging: LoggingDraft,
  options: SetOptions,
  projectName: string,
): Promise<OperationResult[]> {
  if (!isInteractiveRun(options)) {
    return applySetOptions(logging, options);
  }
  await configureInteractively(logging, projectLabel(projectName, options.env));
  return [];
}

function projectLabel(projectName: string, envName?: string): string {
  return `${projectName}${envName ? ` (${envName})` : ""}`;
}

function reportNothingToChange(results: OperationResult[]): void {
  const reasons = results.map((result) => result.message);
  const lines = reasons.length > 0 ? reasons : [UNCHANGED_CONFIGURATION];
  lines.forEach((line) => info(`${NOTHING_TO_CHANGE}: ${line}`));
}

function formatResult(result: OperationResult): string {
  return result.isChange
    ? chalk.green(result.message)
    : chalk.yellow(`${NOTHING_TO_CHANGE}: ${result.message}`);
}

async function reportSaved(
  results: OperationResult[],
  label: string,
): Promise<void> {
  if (results.length > 0) {
    const lines = results.map((result) => `  ${formatResult(result)}`);
    const content = [
      chalk.bold.cyan(`Project: ${label}`),
      chalk.cyan("─".repeat(SUMMARY_RULE_WIDTH)),
      "",
      ...lines,
    ].join("\n");
    await displayBox(content, "🔧 Logging Configuration Updated", {
      padding: 1,
      borderColor: "blue",
    });
  }
  success(`Configuration saved successfully.`);
  console.log(
    `Use ${chalk.cyan("ajs project logging show")} to view current settings.`,
  );
}

async function configureInteractively(logging: LoggingDraft, label: string) {
  console.log("");
  info(`Configuring logging for ${chalk.bold(label)}`);
  console.log("");

  const { enableLogging } = await inquirer.prompt<{ enableLogging: boolean }>([
    {
      type: "confirm",
      name: "enableLogging",
      message: "Enable logging?",
      default: logging.enabled,
    },
  ]);

  logging.enabled = enableLogging;

  if (!enableLogging) {
    warning(`Logging has been disabled.`);
    return;
  }

  await configureModuleTracking(logging);
  await configureFormatters(logging);
  await configureDateFormat(logging);
  console.log("");
}

const TRACKING_MODE_HANDLERS: Record<TrackingMode, TrackingModeHandler> = {
  all: async (tracking) => {
    tracking.includes = [];
    tracking.excludes = [];
  },
  whitelist: async (tracking) => {
    await handleModuleList(
      tracking.includes,
      "Enter module name to include (empty to finish):",
      "Included modules:",
    );
    tracking.excludes = [];
  },
  blacklist: async (tracking) => {
    await handleModuleList(
      tracking.excludes,
      "Enter module name to exclude (empty to finish):",
      "Excluded modules:",
    );
    tracking.includes = [];
  },
};

function currentTrackingMode(logging: LoggingDraft): TrackingMode {
  if (logging.moduleTracking.includes.length > 0) {
    return "whitelist";
  }
  return logging.moduleTracking.excludes.length > 0 ? "blacklist" : "all";
}

async function configureModuleTracking(logging: LoggingDraft) {
  const { enableModuleTracking } = await inquirer.prompt<{
    enableModuleTracking: boolean;
  }>([
    {
      type: "confirm",
      name: "enableModuleTracking",
      message: "Enable module tracking?",
      default: logging.moduleTracking.enabled,
    },
  ]);

  logging.moduleTracking.enabled = enableModuleTracking;

  if (!enableModuleTracking) {
    return;
  }

  const { trackingMode } = await inquirer.prompt<{
    trackingMode: TrackingMode;
  }>([
    {
      type: "list",
      name: "trackingMode",
      message: "Select module tracking mode:",
      choices: [
        { name: "Log all modules", value: "all" },
        { name: "Only log specific modules (whitelist)", value: "whitelist" },
        {
          name: "Log all except specific modules (blacklist)",
          value: "blacklist",
        },
      ],
      default: currentTrackingMode(logging),
    },
  ]);

  await TRACKING_MODE_HANDLERS[trackingMode](logging.moduleTracking);
}

async function configureFormatters(logging: LoggingDraft) {
  const { configureFormatters } = await inquirer.prompt<{
    configureFormatters: boolean;
  }>([
    {
      type: "confirm",
      name: "configureFormatters",
      message: "Do you want to configure log formatters?",
      default: false,
    },
  ]);

  if (!configureFormatters) {
    return;
  }

  for (const level of FORMATTER_LEVELS) {
    await configureLevelFormat(logging, level);
  }
}

async function configureLevelFormat(logging: LoggingDraft, level: string) {
  const levelKey = formatterKeyOf(level);
  const levelName = level.toUpperCase();
  const { customizeFormat } = await inquirer.prompt<{
    customizeFormat: boolean;
  }>([
    {
      type: "confirm",
      name: "customizeFormat",
      message: `Customize ${levelName} log format?`,
      default: false,
    },
  ]);

  if (!customizeFormat) {
    return;
  }

  const { format } = await inquirer.prompt<{ format: string }>([
    {
      type: "input",
      name: "format",
      message: `Enter format for ${levelName} level:`,
      default: logging.formatter[levelKey] ?? "",
    },
  ]);

  logging.formatter[levelKey] = format;
}

async function configureDateFormat(logging: LoggingDraft) {
  const { configureDateFormat } = await inquirer.prompt<{
    configureDateFormat: boolean;
  }>([
    {
      type: "confirm",
      name: "configureDateFormat",
      message: "Do you want to customize the date format?",
      default: false,
    },
  ]);

  if (!configureDateFormat) {
    return;
  }

  const { dateFormat } = await inquirer.prompt<{ dateFormat: string }>([
    {
      type: "input",
      name: "dateFormat",
      message: "Enter date format:",
      default: logging.dateFormat || defaultConfigLogging.dateFormat,
    },
  ]);

  logging.dateFormat = dateFormat;
  console.log(`${chalk.cyan("Date format set to:")} ${chalk.dim(dateFormat)}`);
  console.log(
    `${chalk.cyan("Format tokens:")} ${chalk.dim("yyyy, MM, dd, HH, mm, ss (padded values)")}`,
  );
  console.log(
    `${chalk.cyan("Additional:")} ${chalk.dim("SSS (milliseconds), M, d, H, m, s (non-padded)")}`,
  );
}

async function handleModuleList(
  list: string[],
  prompt: string,
  listTitle: string,
) {
  if (list.length > 0) {
    console.log(chalk.cyan(listTitle));
    list.forEach((module, index) => console.log(`  ${index + 1}. ${module}`));
  }

  let moduleName = await promptModuleName(prompt);
  while (moduleName) {
    await toggleListedModule(list, moduleName);
    moduleName = await promptModuleName(prompt);
  }
}

async function promptModuleName(prompt: string): Promise<string> {
  const { moduleName } = await inquirer.prompt<{ moduleName: string }>([
    {
      type: "input",
      name: "moduleName",
      message: prompt,
    },
  ]);
  return moduleName;
}

async function toggleListedModule(list: string[], moduleName: string) {
  if (!list.includes(moduleName)) {
    list.push(moduleName);
    success(`Added ${chalk.bold(moduleName)} to the list.`);
    return;
  }

  warning(`Module ${chalk.bold(moduleName)} is already in the list.`);
  const { removeModule } = await inquirer.prompt<{ removeModule: boolean }>([
    {
      type: "confirm",
      name: "removeModule",
      message: `Do you want to remove ${moduleName} from the list?`,
      default: false,
    },
  ]);

  if (removeModule) {
    list.splice(list.indexOf(moduleName), 1);
    info(`Removed ${chalk.bold(moduleName)} from the list.`);
  }
}

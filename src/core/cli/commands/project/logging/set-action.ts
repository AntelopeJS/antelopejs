import chalk from "chalk";

import { defaultConfigLogging } from "../../../../../logging";
import { writeConfig } from "../../../common";
import { displayBox, info, success, warning } from "../../../cli-ui";
import { createPrompter, type Prompter } from "../../../output";
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
import {
  assertSetUsage,
  isInteractiveRun,
  SET_COMMAND,
  SET_OPTION_FLAGS,
} from "./set-usage";

type TrackingMode = "all" | "whitelist" | "blacklist";
type TrackingModeHandler = (
  tracking: ModuleTrackingDraft,
  prompter: Prompter,
) => Promise<void>;

const NOTHING_TO_CHANGE = "Nothing to change";
const UNCHANGED_CONFIGURATION =
  "the logging configuration already has these settings";
const SUMMARY_RULE_WIDTH = 40;

export async function runSet(options: SetOptions): Promise<void> {
  const prompter = createPrompter({ command: SET_COMMAND });
  assertSetUsage(options, prompter);
  const { config, environmentConfig } = await resolveProjectContext(
    options.project,
    options.env,
  );
  console.log("");

  const before = resolveLoggingDraft(config, environmentConfig);
  const after = structuredClone(before);
  const results = await collectChanges(after, options, config.name, prompter);

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
  prompter: Prompter,
): Promise<OperationResult[]> {
  if (!isInteractiveRun(options)) {
    return applySetOptions(logging, options);
  }
  await configureInteractively(
    logging,
    projectLabel(projectName, options.env),
    prompter,
  );
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

async function configureInteractively(
  logging: LoggingDraft,
  label: string,
  prompter: Prompter,
) {
  console.log("");
  info(`Configuring logging for ${chalk.bold(label)}`);
  console.log("");

  logging.enabled = await prompter.confirm({
    message: "Enable logging?",
    flag: `${SET_OPTION_FLAGS.enable} | ${SET_OPTION_FLAGS.disable}`,
    defaultAnswer: logging.enabled,
  });

  if (!logging.enabled) {
    warning(`Logging has been disabled.`);
    return;
  }

  await configureModuleTracking(logging, prompter);
  await configureFormatters(logging, prompter);
  await configureDateFormat(logging, prompter);
  console.log("");
}

const TRACKING_MODE_HANDLERS: Record<TrackingMode, TrackingModeHandler> = {
  all: async (tracking) => {
    tracking.includes = [];
    tracking.excludes = [];
  },
  whitelist: async (tracking, prompter) => {
    await handleModuleList(prompter, tracking.includes, {
      message: "Enter module name to include (empty to finish):",
      flag: `${SET_OPTION_FLAGS.includeModule} <module>`,
      title: "Included modules:",
    });
    tracking.excludes = [];
  },
  blacklist: async (tracking, prompter) => {
    await handleModuleList(prompter, tracking.excludes, {
      message: "Enter module name to exclude (empty to finish):",
      flag: `${SET_OPTION_FLAGS.excludeModule} <module>`,
      title: "Excluded modules:",
    });
    tracking.includes = [];
  },
};

function currentTrackingMode(logging: LoggingDraft): TrackingMode {
  if (logging.moduleTracking.includes.length > 0) {
    return "whitelist";
  }
  return logging.moduleTracking.excludes.length > 0 ? "blacklist" : "all";
}

async function configureModuleTracking(
  logging: LoggingDraft,
  prompter: Prompter,
) {
  logging.moduleTracking.enabled = await prompter.confirm({
    message: "Enable module tracking?",
    flag: SET_OPTION_FLAGS.enableModuleTracking,
    defaultAnswer: logging.moduleTracking.enabled,
  });

  if (!logging.moduleTracking.enabled) {
    return;
  }

  const trackingMode = await prompter.select<TrackingMode>({
    message: "Select module tracking mode:",
    flag: `${SET_OPTION_FLAGS.includeModule} <module>`,
    choices: [
      { value: "all", label: "Log all modules" },
      { value: "whitelist", label: "Only log specific modules (whitelist)" },
      {
        value: "blacklist",
        label: "Log all except specific modules (blacklist)",
      },
    ],
    defaultAnswer: currentTrackingMode(logging),
  });

  await TRACKING_MODE_HANDLERS[trackingMode](logging.moduleTracking, prompter);
}

const LEVEL_FORMAT_FLAG = `${SET_OPTION_FLAGS.level} <level> ${SET_OPTION_FLAGS.format} <format>`;
const DATE_FORMAT_FLAG = `${SET_OPTION_FLAGS.dateFormat} <format>`;

async function configureFormatters(logging: LoggingDraft, prompter: Prompter) {
  const isConfiguringFormatters = await prompter.confirm({
    message: "Do you want to configure log formatters?",
    flag: LEVEL_FORMAT_FLAG,
    defaultAnswer: false,
  });

  if (!isConfiguringFormatters) {
    return;
  }

  for (const level of FORMATTER_LEVELS) {
    await configureLevelFormat(logging, level, prompter);
  }
}

async function configureLevelFormat(
  logging: LoggingDraft,
  level: string,
  prompter: Prompter,
) {
  const levelKey = formatterKeyOf(level);
  const levelName = level.toUpperCase();
  const isCustomizing = await prompter.confirm({
    message: `Customize ${levelName} log format?`,
    flag: LEVEL_FORMAT_FLAG,
    defaultAnswer: false,
  });

  if (!isCustomizing) {
    return;
  }

  logging.formatter[levelKey] = await prompter.text({
    message: `Enter format for ${levelName} level:`,
    flag: LEVEL_FORMAT_FLAG,
    defaultAnswer: logging.formatter[levelKey] ?? "",
  });
}

async function configureDateFormat(logging: LoggingDraft, prompter: Prompter) {
  const isCustomizing = await prompter.confirm({
    message: "Do you want to customize the date format?",
    flag: DATE_FORMAT_FLAG,
    defaultAnswer: false,
  });

  if (!isCustomizing) {
    return;
  }

  const dateFormat = await prompter.text({
    message: "Enter date format:",
    flag: DATE_FORMAT_FLAG,
    defaultAnswer: logging.dateFormat || defaultConfigLogging.dateFormat,
  });

  logging.dateFormat = dateFormat;
  console.log(`${chalk.cyan("Date format set to:")} ${chalk.dim(dateFormat)}`);
  console.log(
    `${chalk.cyan("Format tokens:")} ${chalk.dim("yyyy, MM, dd, HH, mm, ss (padded values)")}`,
  );
  console.log(
    `${chalk.cyan("Additional:")} ${chalk.dim("SSS (milliseconds), M, d, H, m, s (non-padded)")}`,
  );
}

interface ModuleListPrompt {
  message: string;
  flag: string;
  title: string;
}

async function handleModuleList(
  prompter: Prompter,
  list: string[],
  prompt: ModuleListPrompt,
) {
  if (list.length > 0) {
    console.log(chalk.cyan(prompt.title));
    list.forEach((module, index) => console.log(`  ${index + 1}. ${module}`));
  }

  const askModuleName = () =>
    prompter.text({ message: prompt.message, flag: prompt.flag });
  let moduleName = await askModuleName();
  while (moduleName) {
    await toggleListedModule(prompter, list, moduleName);
    moduleName = await askModuleName();
  }
}

async function toggleListedModule(
  prompter: Prompter,
  list: string[],
  moduleName: string,
) {
  if (!list.includes(moduleName)) {
    list.push(moduleName);
    success(`Added ${chalk.bold(moduleName)} to the list.`);
    return;
  }

  warning(`Module ${chalk.bold(moduleName)} is already in the list.`);
  const isRemoving = await prompter.confirm({
    message: `Do you want to remove ${moduleName} from the list?`,
    flag: `${SET_OPTION_FLAGS.removeInclude} <module>`,
    defaultAnswer: false,
  });

  if (isRemoving) {
    list.splice(list.indexOf(moduleName), 1);
    info(`Removed ${chalk.bold(moduleName)} from the list.`);
  }
}

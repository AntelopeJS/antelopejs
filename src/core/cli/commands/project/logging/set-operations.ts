import { levelMap } from "../../../../../logging";
import { getProcessPalette } from "../../../output";
import type { LoggingDraft, ModuleTrackingDraft } from "./logging-draft";

export interface SetOptions {
  project: string;
  env?: string;
  enable?: boolean;
  disable?: boolean;
  enableModuleTracking?: boolean;
  disableModuleTracking?: boolean;
  includeModule?: string;
  excludeModule?: string;
  removeInclude?: string;
  removeExclude?: string;
  interactive?: boolean;
  level?: string;
  format?: string;
  dateFormat?: string;
}

export interface OperationResult {
  isChange: boolean;
  message: string;
}

type LoggingOperation = (
  logging: LoggingDraft,
  options: SetOptions,
) => OperationResult | undefined;

type ModuleListKey = keyof Pick<ModuleTrackingDraft, "includes" | "excludes">;

const DEFAULT_FORMATTER_LEVEL = "default";

export const FORMATTER_LEVELS = [
  ...Object.keys(levelMap),
  DEFAULT_FORMATTER_LEVEL,
];

const MODULE_LIST_NAMES: Record<ModuleListKey, string> = {
  includes: "include list",
  excludes: "exclude list",
};

export function formatterKeyOf(level: string): string {
  return Object.hasOwn(levelMap, level)
    ? String(levelMap[level])
    : DEFAULT_FORMATTER_LEVEL;
}

function toggle(
  label: string,
  current: boolean,
  wanted: boolean,
  write: () => void,
): OperationResult {
  const state = wanted ? "enabled" : "disabled";
  if (current === wanted) {
    return { isChange: false, message: `${label} is already ${state}` };
  }
  write();
  return { isChange: true, message: `${label} ${state}` };
}

function toggleLogging(logging: LoggingDraft, wanted: boolean) {
  return toggle("Logging", logging.enabled, wanted, () => {
    logging.enabled = wanted;
  });
}

function toggleModuleTracking(logging: LoggingDraft, wanted: boolean) {
  const tracking = logging.moduleTracking;
  return toggle("Module tracking", tracking.enabled, wanted, () => {
    tracking.enabled = wanted;
  });
}

function assign(
  label: string,
  current: string,
  wanted: string,
  write: () => void,
): OperationResult {
  if (current === wanted) {
    return {
      isChange: false,
      message: `${label} is already ${getProcessPalette().dim(wanted)}`,
    };
  }
  write();
  return {
    isChange: true,
    message: `Set ${label} to ${getProcessPalette().dim(wanted)}`,
  };
}

function setDateFormat(logging: LoggingDraft, dateFormat: string) {
  return assign("date format", logging.dateFormat, dateFormat, () => {
    logging.dateFormat = dateFormat;
  });
}

function setLevelFormat(logging: LoggingDraft, level: string, format: string) {
  const key = formatterKeyOf(level);
  const label = `${getProcessPalette().bold(level.toUpperCase())} format`;
  return assign(label, logging.formatter[key] ?? "", format, () => {
    logging.formatter[key] = format;
  });
}

function addModule(
  logging: LoggingDraft,
  listKey: ModuleListKey,
  module: string,
): OperationResult {
  const list = logging.moduleTracking[listKey];
  const listName = MODULE_LIST_NAMES[listKey];
  if (list.includes(module)) {
    return {
      isChange: false,
      message: `${getProcessPalette().bold(module)} is already in the ${listName}`,
    };
  }
  list.push(module);
  return {
    isChange: true,
    message: `Added ${getProcessPalette().bold(module)} to the ${listName}`,
  };
}

function removeModule(
  logging: LoggingDraft,
  listKey: ModuleListKey,
  module: string,
): OperationResult {
  const list = logging.moduleTracking[listKey];
  const listName = MODULE_LIST_NAMES[listKey];
  const index = list.indexOf(module);
  if (index === -1) {
    return {
      isChange: false,
      message: `${getProcessPalette().bold(module)} is not in the ${listName}`,
    };
  }
  list.splice(index, 1);
  return {
    isChange: true,
    message: `Removed ${getProcessPalette().bold(module)} from the ${listName}`,
  };
}

function whenGiven<T>(
  value: T | undefined,
  operation: (value: T) => OperationResult,
): OperationResult | undefined {
  return value ? operation(value) : undefined;
}

const OPERATIONS: LoggingOperation[] = [
  (logging, options) =>
    whenGiven(options.enable, () => toggleLogging(logging, true)),
  (logging, options) =>
    whenGiven(options.disable, () => toggleLogging(logging, false)),
  (logging, options) =>
    whenGiven(options.enableModuleTracking, () =>
      toggleModuleTracking(logging, true),
    ),
  (logging, options) =>
    whenGiven(options.disableModuleTracking, () =>
      toggleModuleTracking(logging, false),
    ),
  (logging, options) =>
    whenGiven(options.dateFormat, (dateFormat) =>
      setDateFormat(logging, dateFormat),
    ),
  (logging, options) =>
    whenGiven(options.includeModule, (module) =>
      addModule(logging, "includes", module),
    ),
  (logging, options) =>
    whenGiven(options.excludeModule, (module) =>
      addModule(logging, "excludes", module),
    ),
  (logging, options) =>
    whenGiven(options.removeInclude, (module) =>
      removeModule(logging, "includes", module),
    ),
  (logging, options) =>
    whenGiven(options.removeExclude, (module) =>
      removeModule(logging, "excludes", module),
    ),
  (logging, options) =>
    whenGiven(options.level, (level) =>
      setLevelFormat(logging, level, options.format ?? ""),
    ),
];

/**
 * Applies every setting given on the command line to the draft, in a fixed
 * order, and describes each one: a change, or the reason it changes nothing.
 */
export function applySetOptions(
  logging: LoggingDraft,
  options: SetOptions,
): OperationResult[] {
  return OPERATIONS.flatMap((operation) => operation(logging, options) ?? []);
}

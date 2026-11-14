import type {
  AntelopeConfig,
  AntelopeLogging,
} from "@antelopejs/interface-core/config";
import { isDeepStrictEqual } from "node:util";

import { defaultConfigLogging } from "../../../../logging";
import { mergeDeep } from "../../../../utils";

export interface ModuleTrackingDraft {
  enabled: boolean;
  includes: string[];
  excludes: string[];
}

export interface LoggingDraft extends AntelopeLogging {
  enabled: boolean;
  moduleTracking: ModuleTrackingDraft;
  formatter: Record<string, string>;
  dateFormat: string;
}

function toDraft(logging: AntelopeLogging): LoggingDraft {
  const moduleTracking = logging.moduleTracking ?? {};
  return {
    ...logging,
    enabled: Boolean(logging.enabled),
    moduleTracking: {
      enabled: Boolean(moduleTracking.enabled),
      includes: moduleTracking.includes ?? [],
      excludes: moduleTracking.excludes ?? [],
    },
    formatter: logging.formatter ?? {},
    dateFormat: logging.dateFormat ?? "",
  };
}

/**
 * The logging settings the environment runs with: the built-in defaults,
 * overridden by the project `logging` block, overridden in turn by the
 * environment's own block. Editing the returned copy leaves the
 * configuration untouched.
 */
export function resolveLoggingDraft(
  config: AntelopeConfig,
  environmentConfig: Partial<AntelopeConfig>,
): LoggingDraft {
  const environmentLogging =
    environmentConfig === config ? undefined : environmentConfig.logging;
  const effective = mergeDeep(
    {},
    defaultConfigLogging,
    config.logging,
    environmentLogging,
  );
  return toDraft(structuredClone(effective));
}

type ModuleTracking = NonNullable<AntelopeLogging["moduleTracking"]>;

function trackingChanges(
  before: ModuleTrackingDraft,
  after: ModuleTrackingDraft,
): ModuleTracking {
  const changes: ModuleTracking = {};
  if (!isDeepStrictEqual(before.enabled, after.enabled)) {
    changes.enabled = after.enabled;
  }
  if (!isDeepStrictEqual(before.includes, after.includes)) {
    changes.includes = after.includes;
  }
  if (!isDeepStrictEqual(before.excludes, after.excludes)) {
    changes.excludes = after.excludes;
  }
  return changes;
}

function formatterChanges(
  before: Record<string, string>,
  after: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(after).filter(
      ([level, format]) =>
        !isDeepStrictEqual(
          Object.hasOwn(before, level) ? before[level] : undefined,
          format,
        ),
    ),
  );
}

/**
 * The settings a draft edits that differ between `before` and `after`, in the
 * order of the built-in block: a section keeps only its changed entries, and a
 * module list is taken whole.
 */
function loggingChanges(
  before: LoggingDraft,
  after: LoggingDraft,
): AntelopeLogging {
  const changes: AntelopeLogging = {};
  if (!isDeepStrictEqual(before.enabled, after.enabled)) {
    changes.enabled = after.enabled;
  }
  const moduleTracking = trackingChanges(
    before.moduleTracking,
    after.moduleTracking,
  );
  if (Object.keys(moduleTracking).length > 0) {
    changes.moduleTracking = moduleTracking;
  }
  const formatter = formatterChanges(before.formatter, after.formatter);
  if (Object.keys(formatter).length > 0) {
    changes.formatter = formatter;
  }
  if (!isDeepStrictEqual(before.dateFormat, after.dateFormat)) {
    changes.dateFormat = after.dateFormat;
  }
  return changes;
}

/**
 * Writes into the environment's `logging` block only the settings that differ
 * between the two drafts. Returns `false`, writing nothing, when none does.
 */
export function applyLoggingChanges(
  environmentConfig: Partial<AntelopeConfig>,
  before: LoggingDraft,
  after: LoggingDraft,
): boolean {
  const changes = loggingChanges(before, after);
  if (Object.keys(changes).length === 0) {
    return false;
  }
  environmentConfig.logging = mergeDeep(
    environmentConfig.logging ?? {},
    changes,
  );
  return true;
}

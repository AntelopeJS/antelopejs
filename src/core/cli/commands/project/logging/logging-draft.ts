import type {
  AntelopeConfig,
  AntelopeLogging,
} from "@antelopejs/interface-core/config";

import { defaultConfigLogging } from "../../../../../logging";
import { diffDeep, mergeDeep } from "../../../../../utils/object";

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

/**
 * Writes into the environment's `logging` block only the settings that differ
 * between the two drafts. Returns `false`, writing nothing, when none does.
 */
export function applyLoggingChanges(
  environmentConfig: Partial<AntelopeConfig>,
  before: LoggingDraft,
  after: LoggingDraft,
): boolean {
  const changes = diffDeep(before, after);
  if (Object.keys(changes).length === 0) {
    return false;
  }
  environmentConfig.logging = mergeDeep(
    environmentConfig.logging ?? {},
    changes,
  );
  return true;
}

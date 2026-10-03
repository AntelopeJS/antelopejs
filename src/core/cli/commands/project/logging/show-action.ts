import type { AntelopeLogging } from "@antelopejs/interface-core/config";

import { ConfigLoader } from "../../../../config";
import { mergeDeep } from "../../../../../utils/object";
import { NodeFileSystem } from "../../../../filesystem";
import { defaultConfigLogging, levelNames } from "../../../../../logging";
import {
  getProcessUi,
  writeData,
  type DetailEntry,
  type Ui,
} from "../../../output";
import { resolveProjectContext } from "../../shared/project-command";

interface ShowOptions {
  project: string;
  env?: string;
  json?: boolean;
}

const TRACKING_DISABLED = "off";
const TRACKING_ALL_MODULES = "all modules";
const LIST_SEPARATOR = ", ";
const TEMPLATES_HINT = "see --json for the templates";

function describeModuleTracking(logging: AntelopeLogging): string {
  const tracking = logging.moduleTracking ?? {};
  if (!tracking.enabled) {
    return TRACKING_DISABLED;
  }
  const includes = tracking.includes ?? [];
  const excludes = tracking.excludes ?? [];
  if (includes.length > 0) {
    return `only ${includes.join(LIST_SEPARATOR)}`;
  }
  if (excludes.length > 0) {
    return `all except ${excludes.join(LIST_SEPARATOR)}`;
  }
  return TRACKING_ALL_MODULES;
}

function levelLabel(level: string): string {
  return levelNames[Number(level)] ?? level;
}

function describeLevelFormats(logging: AntelopeLogging): string {
  const defaults: Record<string, string> = defaultConfigLogging.formatter ?? {};
  const customLevels = Object.entries(logging.formatter ?? {})
    .filter(([level, template]) => template !== defaults[level])
    .map(([level]) => levelLabel(level));
  const summary =
    customLevels.length > 0
      ? `custom for ${customLevels.join(LIST_SEPARATOR)}`
      : "default";
  return `${summary}, ${TEMPLATES_HINT}`;
}

function describeLogging(logging: AntelopeLogging): DetailEntry[] {
  return [
    { label: "Enabled", value: logging.enabled ? "yes" : "no" },
    { label: "Module tracking", value: describeModuleTracking(logging) },
    {
      label: "Date format",
      value: logging.dateFormat || defaultConfigLogging.dateFormat || "",
    },
    { label: "Level formats", value: describeLevelFormats(logging) },
  ];
}

function renderLogging(
  logging: AntelopeLogging,
  location: string,
  ui: Ui,
): void {
  ui.message("info", `Logging configuration of ${location}`);
  ui.details(describeLogging(logging));
}

async function showLogging(options: ShowOptions, ui: Ui): Promise<void> {
  const { config, environment } = await resolveProjectContext(
    options.project,
    options.env,
  );
  const loader = new ConfigLoader(new NodeFileSystem());
  const antelopeConfig = await loader.load(options.project, environment);
  const logging: AntelopeLogging = mergeDeep(
    {},
    defaultConfigLogging,
    antelopeConfig.logging,
  );
  writeData(ui, {
    data: logging,
    isJson: options.json,
    render: (target) =>
      renderLogging(logging, `${config.name} (${environment})`, target),
  });
}

export function showLoggingAction(ui: Ui = getProcessUi()) {
  return (options: ShowOptions) => showLogging(options, ui);
}

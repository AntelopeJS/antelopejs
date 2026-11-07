import type { Journey } from "../lib/journey.mts";
import { initJourneys as moduleInit, testJourneys as moduleTest } from "./module.mts";
import { buildJourneys, startJourneys } from "./project-build-start.mts";
import { journeys as projectDev } from "./project-dev.mts";
import { journeys as projectInit } from "./project-init.mts";
import { journeys as projectLogging } from "./project-logging.mts";
import { journeys as projectModuleLocks } from "./project-module-locks.mts";
import { journeys as projectModules } from "./project-modules.mts";
import { embeddedJourneys, launchJourneys, resolutionJourneys } from "./runtime.mts";
import { configJourneys, pluginJourneys, shellJourneys } from "./settings.mts";
import { journeys as smoke } from "./smoke.mts";

const FEATURES = {
  smoke,
  "project-init": projectInit,
  "project-dev": projectDev,
  "project-build": buildJourneys,
  "project-start": startJourneys,
  "project-modules": projectModules,
  "project-module-locks": projectModuleLocks,
  "project-logging": projectLogging,
  "module-init": moduleInit,
  "module-test": moduleTest,
  config: configJourneys,
  plugins: pluginJourneys,
  "cli-shell": shellJourneys,
  "embedded-runtime": embeddedJourneys,
  "library-launch": launchJourneys,
  "interface-resolution": resolutionJourneys,
} satisfies Record<string, Journey[]>;

/** Every feature of the map with its journeys. */
export const FEATURE_JOURNEYS = new Map<string, Journey[]>(Object.entries(FEATURES));

const SERIAL: readonly (readonly [keyof typeof FEATURES, string])[] = [];

/**
 * The features whose journeys must run one after another, each with the
 * reason. A journey of any other feature may run at the same time as any other
 * journey: it owns its HOME, work folder, evidence folder and ports, and reads
 * nothing another journey leaves. A feature belongs here only when one of its
 * journeys does read what an earlier one left.
 */
export const SERIAL_FEATURES: ReadonlyMap<string, string> = new Map(SERIAL);

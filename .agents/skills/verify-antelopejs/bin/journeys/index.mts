import type { Journey } from "../lib/journey.mts";
import { initJourneys as moduleInit, testJourneys as moduleTest } from "./module.mts";
import { buildJourneys, startJourneys } from "./project-build-start.mts";
import { journeys as projectDev } from "./project-dev.mts";
import { journeys as projectInit } from "./project-init.mts";
import { journeys as projectLogging } from "./project-logging.mts";
import { journeys as projectModules } from "./project-modules.mts";
import { embeddedJourneys, launchJourneys, resolutionJourneys } from "./runtime.mts";
import { configJourneys, pluginJourneys, shellJourneys } from "./settings.mts";
import { journeys as smoke } from "./smoke.mts";

/** Every feature of the map with its journeys. */
export const FEATURE_JOURNEYS = new Map(
  Object.entries({
  smoke,
  "project-init": projectInit,
  "project-dev": projectDev,
  "project-build": buildJourneys,
  "project-start": startJourneys,
  "project-modules": projectModules,
  "project-logging": projectLogging,
  "module-init": moduleInit,
  "module-test": moduleTest,
  config: configJourneys,
  plugins: pluginJourneys,
  "cli-shell": shellJourneys,
  "embedded-runtime": embeddedJourneys,
  "library-launch": launchJourneys,
  "interface-resolution": resolutionJourneys,
} satisfies Record<string, Journey[]>),
);

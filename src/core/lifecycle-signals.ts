import { channel } from "node:diagnostics_channel";

/** Published when every module of a start has started; carries an empty object. */
const MODULES_STARTED_CHANNEL = "antelopejs.modules.started";

/** Published before the first module stops; carries an empty object. */
const MODULES_STOPPING_CHANNEL = "antelopejs.modules.stopping";

const startedChannel = channel(MODULES_STARTED_CHANNEL);
const stoppingChannel = channel(MODULES_STOPPING_CHANNEL);

let areModulesStarted = false;

/** Announces that every module the core was asked to start is ready to serve. */
export function announceModulesStarted(): void {
  areModulesStarted = true;
  startedChannel.publish({});
}

/**
 * Announces that modules are about to stop. Only the first stop after a
 * start announces it: stopping every module of a project, or reloading one,
 * is a single "stopping" for whoever closes the gate.
 */
export function announceModulesStopping(): void {
  if (!areModulesStarted) {
    return;
  }
  areModulesStarted = false;
  stoppingChannel.publish({});
}

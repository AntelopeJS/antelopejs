import { Events } from "@antelopejs/interface-core/modules";

let isProjectActive = false;

let stopCount = 0;

/**
 * Marks the start of a set of modules, so a stop from now on is announced
 * even if their `start` has not settled yet.
 *
 * @returns announces, through `Events.ModulesStarted`, that every module of
 * this start is ready to serve. It announces nothing once the project began
 * stopping after this start began, so a stop is never followed by "started".
 */
export function beginModulesStart(): () => void {
  isProjectActive = true;
  const stopsAtStart = stopCount;
  return () => {
    if (stopCount === stopsAtStart) {
      Events.ModulesStarted.emit();
    }
  };
}

/**
 * Announces, through `Events.ModulesStopping`, that the project's modules are
 * about to stop: a shutdown or a full teardown, never one module stopped,
 * reloaded or removed at runtime. Its subscribers close the whole project
 * (the HTTP startup gate answers 503), so a single module must not trigger it.
 * It is announced once a start has begun, so work a `start` awaits can stop,
 * and only once per start, so a `stopAll` followed by `destroyAll` is a single
 * "stopping".
 */
export function announceModulesStopping(): void {
  if (!isProjectActive) {
    return;
  }
  isProjectActive = false;
  stopCount += 1;
  Events.ModulesStopping.emit();
}

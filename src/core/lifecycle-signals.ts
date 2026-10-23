import { Events } from "@antelopejs/interface-core/modules";

let areModulesStarted = false;

/**
 * Announces, through `Events.ModulesStarted`, that every module the core was
 * asked to start is ready to serve.
 */
export function announceModulesStarted(): void {
  areModulesStarted = true;
  Events.ModulesStarted.emit();
}

/**
 * Announces, through `Events.ModulesStopping`, that the project's modules are
 * about to stop: a shutdown or a full teardown, never one module stopped,
 * reloaded or removed at runtime. Its subscribers close the whole project
 * (the HTTP startup gate answers 503), so a single module must not trigger it.
 * Only the first announcement after a start is emitted, so a `stopAll`
 * followed by `destroyAll` is a single "stopping".
 */
export function announceModulesStopping(): void {
  if (!areModulesStarted) {
    return;
  }
  areModulesStarted = false;
  Events.ModulesStopping.emit();
}

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
 * Announces, through `Events.ModulesStopping`, that modules are about to
 * stop. Only the first stop after a start announces it: stopping every
 * module of a project, or reloading one, is a single "stopping" for whoever
 * closes the gate.
 */
export function announceModulesStopping(): void {
  if (!areModulesStarted) {
    return;
  }
  areModulesStarted = false;
  Events.ModulesStopping.emit();
}

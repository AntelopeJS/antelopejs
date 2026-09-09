import { type TracingChannel, tracingChannel } from "node:diagnostics_channel";

/** Payload published on every module lifecycle tracing channel. */
export interface ModuleDiagnosticsContext {
  moduleId: string;
  moduleVersion: string;
}

export type ModuleTracingChannel = TracingChannel<
  ModuleDiagnosticsContext,
  ModuleDiagnosticsContext
>;

/** The five module lifecycle operations published as tracing channels. */
export interface ModuleDiagnosticsChannels {
  load: ModuleTracingChannel;
  construct: ModuleTracingChannel;
  start: ModuleTracingChannel;
  stop: ModuleTracingChannel;
  destroy: ModuleTracingChannel;
}

export function moduleDiagnosticsContext(
  moduleId: string,
  moduleVersion: string,
): ModuleDiagnosticsContext {
  return { moduleId, moduleVersion };
}

const MODULE_LOAD_CHANNEL = "antelopejs.module.load";
const MODULE_CONSTRUCT_CHANNEL = "antelopejs.module.construct";
const MODULE_START_CHANNEL = "antelopejs.module.start";
const MODULE_STOP_CHANNEL = "antelopejs.module.stop";
const MODULE_DESTROY_CHANNEL = "antelopejs.module.destroy";

export const ModuleDiagnostics: ModuleDiagnosticsChannels = {
  load: tracingChannel<ModuleDiagnosticsContext>(MODULE_LOAD_CHANNEL),
  construct: tracingChannel<ModuleDiagnosticsContext>(MODULE_CONSTRUCT_CHANNEL),
  start: tracingChannel<ModuleDiagnosticsContext>(MODULE_START_CHANNEL),
  stop: tracingChannel<ModuleDiagnosticsContext>(MODULE_STOP_CHANNEL),
  destroy: tracingChannel<ModuleDiagnosticsContext>(MODULE_DESTROY_CHANNEL),
};

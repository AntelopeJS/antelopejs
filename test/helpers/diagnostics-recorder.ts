import type { TracingChannelSubscribers } from "node:diagnostics_channel";
import {
  ModuleDiagnostics,
  type ModuleDiagnosticsChannels,
  type ModuleDiagnosticsContext,
} from "../../src/core/diagnostics";

export type ModuleOperation = keyof ModuleDiagnosticsChannels;

export type SpanEventName =
  | "start"
  | "end"
  | "asyncStart"
  | "asyncEnd"
  | "error";

export interface RecordedPayload extends ModuleDiagnosticsContext {
  result?: unknown;
  error?: unknown;
}

export interface RecordedEvent {
  operation: ModuleOperation;
  event: SpanEventName;
  payload: RecordedPayload;
}

export interface DiagnosticsRecorder {
  events: RecordedEvent[];
  trace: () => string[];
  restore: () => void;
}

const OPERATION_SEPARATOR = ":";

/** Events published by one span that neither fails nor is interrupted. */
export const SPAN_EVENT_COUNT = 4;

function createSubscribers(
  operation: ModuleOperation,
  record: (event: RecordedEvent) => void,
): TracingChannelSubscribers<ModuleDiagnosticsContext> {
  const on = (event: SpanEventName) => (payload: RecordedPayload) => {
    record({ operation, event, payload: { ...payload } });
  };
  return {
    start: on("start"),
    end: on("end"),
    asyncStart: on("asyncStart"),
    asyncEnd: on("asyncEnd"),
    error: on("error"),
  };
}

function operations(): ModuleOperation[] {
  return Object.keys(ModuleDiagnostics) as ModuleOperation[];
}

/** Subscribes to every module lifecycle channel and collects the published events. */
export function recordModuleDiagnostics(
  moduleId?: string,
): DiagnosticsRecorder {
  const events: RecordedEvent[] = [];
  const record = (event: RecordedEvent) => {
    if (moduleId === undefined || event.payload.moduleId === moduleId) {
      events.push(event);
    }
  };
  const subscribers = new Map<
    ModuleOperation,
    TracingChannelSubscribers<ModuleDiagnosticsContext>
  >();
  for (const operation of operations()) {
    const handlers = createSubscribers(operation, record);
    subscribers.set(operation, handlers);
    ModuleDiagnostics[operation].subscribe(handlers);
  }

  return {
    events,
    trace: () =>
      events.map(
        ({ operation, event }) => `${operation}${OPERATION_SEPARATOR}${event}`,
      ),
    restore: () => {
      for (const [operation, handlers] of subscribers) {
        ModuleDiagnostics[operation].unsubscribe(handlers);
      }
      subscribers.clear();
    },
  };
}

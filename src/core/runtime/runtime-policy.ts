/** Process-level responsibilities the runtime claims from whoever owns the process. */
export interface RuntimePolicy {
  /** Install `uncaughtException` / `unhandledRejection` / `warning` handlers. */
  processHandlers: boolean;
  /** Claim `SIGINT` and `SIGTERM`. */
  signals: boolean;
  /** Draw progress spinners on stdout. */
  terminal: boolean;
  /** Reset the global logger and take over the log transport. */
  logging: boolean;
}

export const DEFAULT_RUNTIME_POLICY: Readonly<RuntimePolicy> = Object.freeze({
  processHandlers: true,
  signals: true,
  terminal: true,
  logging: true,
});

export const EMBEDDED_RUNTIME_POLICY: Readonly<RuntimePolicy> = Object.freeze({
  processHandlers: false,
  signals: false,
  terminal: false,
  logging: false,
});

export function resolveRuntimePolicy(
  overrides: Partial<RuntimePolicy> = {},
  base: Readonly<RuntimePolicy> = DEFAULT_RUNTIME_POLICY,
): RuntimePolicy {
  return { ...base, ...overrides };
}

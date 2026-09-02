import type {
  AntelopeLogging,
  ImportOverride,
} from "@antelopejs/interface-core/config";
import type { RuntimePolicy } from "../runtime/runtime-policy";

/** One module the embedded runtime should load, keyed by its package name. */
export interface EmbeddedModuleConfig {
  /** Absolute, or relative to the project folder. Defaults to the host's `node_modules`. */
  path?: string;
  config?: unknown;
  importOverrides?: ImportOverride[];
  disabledExports?: string[];
}

export interface EmbeddedRuntimeOptions {
  /** Directory modules and relative paths resolve from. Defaults to `process.cwd()`. */
  projectFolder?: string;
  env?: string;
  /** Modules to load, keyed by package name. */
  modules?: Record<string, EmbeddedModuleConfig>;
  /** Interface packages the host consumes. Each is verified at startup. */
  uses?: string[];
  /** Interface packages the host implements, registering it as their provider. */
  provides?: string[];
  /** Supplying this turns the `logging` policy on. Leave unset to keep the host's logger. */
  logging?: AntelopeLogging;
  /** Process responsibilities to reclaim from the host. All default to off. */
  policy?: Partial<RuntimePolicy>;
}

/** A host registration that must be released explicitly. */
export interface ProvideHandle {
  detach(): void;
}

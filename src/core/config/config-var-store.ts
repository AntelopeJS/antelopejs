import type {
  ConfigVars,
  ConfigVarValue,
} from "@antelopejs/interface-core/config";

import { isObject } from "../../utils/object";
import { type ConfigVarReference, substituteConfigVars } from "./config-vars";

/**
 * The config variables every constructed module published.
 *
 * A value enters the store once, when its provider publishes it, and is frozen
 * from then on: consumers are resolved against it and never re-resolved.
 */
export class ConfigVarStore {
  private readonly published = new Map<string, ConfigVars>();

  /** Freezes what a provider returned, once its `provide` callback resolved. */
  record(moduleId: string, declared: string[], returned: unknown): void {
    const values = isObject(returned) ? (returned as ConfigVars) : {};
    const missing = declared.filter((name) => !(name in values));
    if (missing.length > 0) {
      throw new Error(
        `Module '${moduleId}' declares the config variable(s) '${missing.join("', '")}' in antelopeJs.configVars but its provide callback did not return them.`,
      );
    }
    this.published.set(moduleId, { ...values });
  }

  /** The consumer configuration with every reference replaced by its value. */
  resolve(consumerId: string, config: unknown): unknown {
    return substituteConfigVars(config, (reference) =>
      this.lookup(consumerId, reference),
    );
  }

  clear(): void {
    this.published.clear();
  }

  private lookup(
    consumerId: string,
    reference: ConfigVarReference,
  ): ConfigVarValue {
    const values = this.published.get(reference.module);
    if (!values || !(reference.variable in values)) {
      throw new Error(
        `Module '${consumerId}' references '${reference.token}', but its expected provider '${reference.module}' published no config variable '${reference.variable}'.`,
      );
    }
    return values[reference.variable];
  }
}

import type {
  ConfigVarProvider,
  ConfigVars,
  ConfigVarValue,
} from "@antelopejs/interface-core/config";

import { isObject } from "../../utils";
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
  record(
    moduleId: string,
    declared: string[],
    returned: Awaited<ReturnType<ConfigVarProvider>>,
  ): void {
    // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- record accepts arbitrary provider values and checks names only; enforcing ConfigVarValue would change existing acceptance.
    const values = isObject(returned) ? (returned as ConfigVars) : {};
    const missing = declared.filter((name) => !Object.hasOwn(values, name));
    if (missing.length > 0) {
      throw new Error(
        `Module '${moduleId}' declares the config variable(s) '${missing.join("', '")}' in antelopeJs.configVars but its provide callback did not return them.`,
      );
    }
    this.published.set(moduleId, { ...values });
  }

  /** The consumer configuration with every reference replaced by its value. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- substitutes config variables into a module config, user JS data that can hold RegExp and functions, and returns it with its unreferenced branches by identity
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
    if (!values || !Object.hasOwn(values, reference.variable)) {
      throw new Error(
        `Module '${consumerId}' references '${reference.token}', but its expected provider '${reference.module}' published no config variable '${reference.variable}'.`,
      );
    }
    return values[reference.variable];
  }
}

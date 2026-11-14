import type {
  ConfigVarProvider,
  ConfigVars,
  ConfigVarValue,
} from "@antelopejs/interface-core/config";

import { isBoolean, isNumber, isObject, isString } from "../../utils";
import { type ConfigVarReference, substituteConfigVars } from "./config-vars";

function isConfigVarValue(value: unknown): value is ConfigVarValue {
  return isString(value) || isNumber(value) || isBoolean(value);
}

/**
 * The config variables every constructed module published.
 *
 * A value enters the store once, when its provider publishes it, and is frozen
 * from then on: consumers are resolved against it and never re-resolved.
 */
export class ConfigVarStore {
  private readonly published = new Map<string, ConfigVars>();

  /**
   * Freezes the declared variables a provider returned, once its `provide`
   * callback resolved.
   *
   * @throws When a declared variable is missing, or its value is not a
   * string, a number, or a boolean. Undeclared keys are dropped: no
   * reference can name them.
   */
  record(
    moduleId: string,
    declared: string[],
    returned: Awaited<ReturnType<ConfigVarProvider>>,
  ): void {
    const values = isObject(returned) ? returned : {};
    const missing = declared.filter((name) => !Object.hasOwn(values, name));
    if (missing.length > 0) {
      throw new Error(
        `Module '${moduleId}' declares the config variable(s) '${missing.join("', '")}' in antelopeJs.configVars but its provide callback did not return them.`,
      );
    }
    const published: ConfigVars = {};
    const invalid: string[] = [];
    for (const name of declared) {
      const value = values[name];
      if (isConfigVarValue(value)) {
        published[name] = value;
      } else {
        invalid.push(name);
      }
    }
    if (invalid.length > 0) {
      throw new Error(
        `Module '${moduleId}' published the config variable(s) '${invalid.join("', '")}' with a value that is not a string, a number, or a boolean.`,
      );
    }
    this.published.set(moduleId, published);
  }

  /** The consumer configuration with every reference replaced by its value. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- substitutes config variables into a module config, any JS value (docs/2.concepts/4.configuration.md, Referencing), through substituteConfigVars, which rebuilds only the arrays and plain objects that hold a reference and returns every other value, such as a RegExp, a Date or a class instance, by identity
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

import type {
  AntelopeLogging,
  AntelopeTestConfig,
  ImportOverride,
  ModuleSource,
  ModuleSourceGit,
  ModuleSourceLocal,
  ModuleSourceLocalFolder,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";
import { isDeepStrictEqual } from "node:util";

import { isBoolean, isNumber, isObject, isString } from "../../utils";
import type { ExpandedModuleConfig } from "./config-parser";

/** The project configuration once templates and environment overrides ran. */
export interface LoadedConfig {
  name: string;
  cacheFolder: string;
  modules: Record<string, ExpandedModuleConfig>;
  logging?: AntelopeLogging;
  envOverrides: Record<string, string | string[]>;
  test?: AntelopeTestConfig;
}

/**
 * Checks one declared field. `loaded` is the same field as the configuration
 * file gave it, before templates and environment overrides. `declared`
 * lets the compiler match each check to the field type it stands for.
 */
interface FieldCheck<T> {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the field as the configuration file gave it, read by key at any depth only to compare it with the checked value
  (value: unknown, loaded: unknown, field: string): asserts value is T;
  readonly declared?: T;
}

type FieldChecks<T> = { [K in keyof T]-?: FieldCheck<T[K]> };

function refuse(field: string, takes: string): never {
  throw new Error(
    `Configuration field '${field}' does not hold ${takes} after templates and environment overrides.`,
  );
}

function leaf<T>(
  takes: string,
  holds: (value: unknown) => value is T,
): FieldCheck<T> {
  return (value, loaded, field) => {
    if (holds(value) || isDeepStrictEqual(value, loaded)) return;
    refuse(field, takes);
  };
}

function optional<T>(check: FieldCheck<T>): FieldCheck<T | undefined> {
  return (value, loaded, field) => {
    if (value !== undefined) check(value, loaded, field);
  };
}

function isContainer(value: unknown): value is object {
  return isObject(value) || Array.isArray(value);
}

function listOf<T>(takes: string, item: FieldCheck<T>): FieldCheck<T[]> {
  return (value, loaded, field) => {
    if (!Array.isArray(value)) {
      if (isDeepStrictEqual(value, loaded)) return;
      refuse(field, takes);
    }
    const items: unknown[] = value;
    items.forEach((entry, index) => {
      item(
        entry,
        isContainer(loaded)
          ? Object.getOwnPropertyDescriptor(loaded, index)?.value
          : undefined,
        `${field}.${index}`,
      );
    });
  };
}

function mapOf<T>(
  takes: string,
  entry: FieldCheck<T>,
): FieldCheck<Record<string, T>> {
  return (value, loaded, field) => {
    if (!isObject(value)) {
      if (isDeepStrictEqual(value, loaded)) return;
      refuse(field, takes);
    }
    for (const [key, item] of Object.entries(value)) {
      entry(
        item,
        isContainer(loaded)
          ? Object.getOwnPropertyDescriptor(loaded, key)?.value
          : undefined,
        `${field}.${key}`,
      );
    }
  };
}

function section<T>(takes: string, fields: FieldChecks<T>): FieldCheck<T> {
  const checks: [string, FieldCheck<unknown>][] = Object.entries(fields);
  return (value, loaded, field) => {
    if (!isObject(value)) {
      if (isDeepStrictEqual(value, loaded)) return;
      refuse(field, takes);
    }
    for (const [key, entry] of checks) {
      const check: FieldCheck<unknown> = entry;
      check(
        Object.getOwnPropertyDescriptor(value, key)?.value,
        isContainer(loaded)
          ? Object.getOwnPropertyDescriptor(loaded, key)?.value
          : undefined,
        field ? `${field}.${key}` : key,
      );
    }
  };
}

function isText(value: unknown): value is string {
  return isString(value);
}

function isTextOrList(value: unknown): value is string | string[] {
  return isString(value) || (Array.isArray(value) && value.every(isString));
}

function isNumberOrText(value: unknown): value is number | string {
  return isNumber(value) || isString(value);
}

function isFlag(value: unknown): value is boolean {
  return isBoolean(value);
}

const text = leaf("a string", isText);
const textOrList = leaf("a string or a list of strings", isTextOrList);
const flag = leaf("a boolean", isFlag);
const texts = listOf("a list of strings", text);

/** A field neither templates nor overrides can produce: it passes only as loaded. */
function asLoaded<T>(takes: string): FieldCheck<T> {
  return (value, loaded, field) => {
    if (!isDeepStrictEqual(value, loaded)) refuse(field, takes);
  };
}

function literal<const L extends string>(expected: L): FieldCheck<L> {
  return leaf(`'${expected}'`, (value): value is L => value === expected);
}

const sourceFields = { id: optional(text), ignoreCache: optional(flag) };

const localSource: FieldCheck<ModuleSourceLocal> = section(
  "a local module source",
  {
    ...sourceFields,
    type: literal("local"),
    path: text,
    main: optional(text),
    watchDir: optional(textOrList),
    installCommand: optional(textOrList),
    reloadCommand: optional(textOrList),
  },
);
const gitSource: FieldCheck<ModuleSourceGit> = section("a git module source", {
  ...sourceFields,
  type: literal("git"),
  remote: text,
  branch: optional(text),
  commit: optional(text),
  installCommand: optional(textOrList),
});
const packageSource: FieldCheck<ModuleSourcePackage> = section(
  "a package module source",
  {
    ...sourceFields,
    type: literal("package"),
    package: text,
    version: text,
  },
);
const localFolderSource: FieldCheck<ModuleSourceLocalFolder> = section(
  "a local-folder module source",
  {
    ...sourceFields,
    type: literal("local-folder"),
    path: text,
    watchDir: optional(textOrList),
    installCommand: optional(textOrList),
    reloadCommand: optional(textOrList),
  },
);

const SOURCE_TAKES =
  "a module source of type local, git, package or local-folder";

const moduleSource: FieldCheck<ModuleSource> = (value, loaded, field) => {
  const type: unknown = isObject(value) ? value.type : undefined;
  if (type === "local") {
    localSource(value, loaded, field);
  } else if (type === "git") {
    gitSource(value, loaded, field);
  } else if (type === "package") {
    packageSource(value, loaded, field);
  } else if (type === "local-folder") {
    localFolderSource(value, loaded, field);
  } else if (!isDeepStrictEqual(value, loaded)) {
    refuse(field, SOURCE_TAKES);
  }
};

const importOverride = section<ImportOverride>("an import override", {
  interface: text,
  source: optional(text),
  id: optional(text),
});

const moduleEntry = section<ExpandedModuleConfig>("a module entry", {
  source: moduleSource,
  config: () => {},
  importOverrides: listOf("a list of import overrides", importOverride),
  disabledExports: texts,
  exportPriority: optional(
    mapOf("a map of export priorities", leaf("a number", isNumber)),
  ),
  optional: optional(flag),
});

const logging = section<AntelopeLogging>("a logging section", {
  enabled: optional(flag),
  moduleTracking: optional(
    section<NonNullable<AntelopeLogging["moduleTracking"]>>(
      "a module tracking section",
      {
        enabled: optional(flag),
        includes: optional(texts),
        excludes: optional(texts),
      },
    ),
  ),
  channelFilter: optional(
    mapOf(
      "a map of channel levels",
      leaf("a number or a string", isNumberOrText),
    ),
  ),
  formatter: optional(mapOf("a map of formatters", text)),
  dateFormat: optional(text),
});

const testSection = section<AntelopeTestConfig>("a test section", {
  folder: optional(text),
  setup: asLoaded("the setup function the configuration file gave"),
  cleanup: asLoaded("the cleanup function the configuration file gave"),
});

const projectFields: FieldChecks<LoadedConfig> = {
  name: text,
  cacheFolder: text,
  modules: mapOf("a map of module entries", moduleEntry),
  logging: optional(logging),
  envOverrides: mapOf("a map of environment overrides", textOrList),
  test: optional(testSection),
};

/**
 * Asserts that templates and environment overrides left every declared
 * field of the project configuration with its declared type. A field that
 * still equals what the configuration file gave it passes as loaded, so a
 * file the loader accepted before keeps loading. A field that a pure `${key}`
 * template or an environment override turned into another type throws an
 * error naming the field. Module `config` sections are not checked: modules
 * take them as `unknown`.
 */
export function assertLoadedConfig(
  value: unknown,
  loaded: LoadedConfig,
): asserts value is LoadedConfig {
  if (!isObject(value)) refuse("project", "a project configuration");
  projectFields.name(value.name, loaded.name, "name");
  projectFields.cacheFolder(
    value.cacheFolder,
    loaded.cacheFolder,
    "cacheFolder",
  );
  projectFields.modules(value.modules, loaded.modules, "modules");
  projectFields.logging(value.logging, loaded.logging, "logging");
  projectFields.envOverrides(
    value.envOverrides,
    loaded.envOverrides,
    "envOverrides",
  );
  projectFields.test(value.test, loaded.test, "test");
}

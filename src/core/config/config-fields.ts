import { isDeepStrictEqual } from "node:util";

import type {
  AntelopeConfig,
  AntelopeLogging,
  AntelopeModuleConfig,
  AntelopeTestConfig,
  ImportOverride,
  ModuleSourceGit,
  ModuleSourceLocal,
  ModuleSourceLocalFolder,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";
import {
  anyValue,
  type FieldCheck,
  FieldError,
  type FieldChecks,
  flag,
  isFunction,
  isObject,
  isString,
  leaf,
  listOf,
  literal,
  mapOf,
  number,
  numberOrText,
  optional,
  section,
  text,
  textOrList,
  texts,
} from "../../utils";
import type { ExpandedModuleConfig } from "./config-parser";
import type { ModuleEntryConfig } from "./module-entry";

/** The project configuration once templates and environment overrides ran. */
export interface LoadedConfig {
  name: string;
  cacheFolder: string;
  modules: Record<string, ExpandedModuleConfig>;
  logging?: AntelopeLogging;
  envOverrides: Record<string, string | string[]>;
  test?: AntelopeTestConfig;
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

const moduleSource: FieldCheck<NonNullable<AntelopeModuleConfig["source"]>> = (
  value,
  field,
) => {
  const type: unknown = isObject(value) ? value.type : undefined;
  if (type === "local") {
    localSource(value, field);
  } else if (type === "git") {
    gitSource(value, field);
  } else if (type === "package") {
    packageSource(value, field);
  } else if (type === "local-folder") {
    localFolderSource(value, field);
  } else {
    throw new FieldError(field, SOURCE_TAKES);
  }
};

/** Checks the declared fields of an import override. */
export const importOverrideCheck = section<ImportOverride>(
  "an import override",
  {
    interface: text,
    source: optional(text),
    id: optional(text),
  },
);

const moduleEntry = section<ExpandedModuleConfig>("a module entry", {
  source: moduleSource,
  config: anyValue,
  importOverrides: listOf("a list of import overrides", importOverrideCheck),
  disabledExports: texts,
  exportPriority: optional(mapOf("a map of export priorities", number)),
  optional: optional(flag),
});

/** Checks the declared fields of a logging section. */
export const loggingCheck = section<AntelopeLogging>("a logging section", {
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
  channelFilter: optional(mapOf("a map of channel levels", numberOrText)),
  formatter: optional(mapOf("a map of formatters", text)),
  dateFormat: optional(text),
});

const testFolder: FieldCheck<string | undefined> = optional(text);

function testSection(
  loaded: AntelopeTestConfig | undefined,
): FieldCheck<AntelopeTestConfig> {
  return (value, field) => {
    if (!isObject(value)) throw new FieldError(field, "a test section");
    testFolder(
      Object.getOwnPropertyDescriptor(value, "folder")?.value,
      `${field}.folder`,
    );
    if (
      !isDeepStrictEqual(
        Object.getOwnPropertyDescriptor(value, "setup")?.value,
        loaded && Object.getOwnPropertyDescriptor(loaded, "setup")?.value,
      )
    ) {
      throw new FieldError(
        `${field}.setup`,
        "the setup function the configuration file gave",
      );
    }
    if (
      !isDeepStrictEqual(
        Object.getOwnPropertyDescriptor(value, "cleanup")?.value,
        loaded && Object.getOwnPropertyDescriptor(loaded, "cleanup")?.value,
      )
    ) {
      throw new FieldError(
        `${field}.cleanup`,
        "the cleanup function the configuration file gave",
      );
    }
  };
}

function projectFields(loaded: LoadedConfig): FieldChecks<LoadedConfig> {
  return {
    name: text,
    cacheFolder: text,
    modules: mapOf("a map of module entries", moduleEntry),
    logging: optional(loggingCheck),
    envOverrides: mapOf("a map of environment overrides", textOrList),
    test: optional(testSection(loaded.test)),
  };
}

/** What changed a loaded configuration before a check, as its errors name it. */
type ConfigChange =
  | "templates and environment overrides"
  | "the test setup overrides";

const LOADER_CHANGE: ConfigChange = "templates and environment overrides";

/**
 * Asserts that `change` left every declared field of the project
 * configuration with its declared type. A field that still equals what the
 * configuration file gave it passes as loaded, so a file the loader accepted
 * before keeps loading. A field that a pure `${key}` template, an environment
 * override or a test setup override turned into another type throws an error
 * naming the field. Module `config` sections are not checked: modules take
 * them as `unknown`.
 */
export function assertLoadedConfig(
  value: unknown,
  loaded: LoadedConfig,
  change: ConfigChange = LOADER_CHANGE,
): asserts value is LoadedConfig {
  reportFieldErrors(change, () => {
    checkProjectFields(value, loaded);
  });
}

function reportFieldErrors(change: ConfigChange, check: () => void): void {
  try {
    check();
  } catch (error) {
    if (!(error instanceof FieldError)) throw error;
    throw configFieldError(error.field, error.takes, change, error);
  }
}

function configFieldError(
  field: string,
  takes: string,
  change: ConfigChange,
  cause?: Error,
) {
  return new Error(
    `Configuration field '${field}' does not hold ${takes} after ${change}.`,
    { cause },
  );
}

/** A value an environment override can write: its text, or the text decoded. */
export type OverrideValue = string | number | boolean;

type OverrideDecoder = (text: string) => boolean | number | undefined;

const FLAG_TEXTS = new Map([
  ["true", true],
  ["false", false],
]);

const readFlag: OverrideDecoder = (text) => FLAG_TEXTS.get(text);

const readNumber: OverrideDecoder = (text) => {
  const read = Number(text);
  return text.trim() !== "" && Number.isFinite(read) ? read : undefined;
};

/**
 * The declared fields of a project configuration that hold a boolean or a
 * number, by path pattern (`*` matches one segment). An override of another
 * field keeps its text, which {@link assertLoadedConfig} then checks.
 */
const TYPED_OVERRIDES: readonly [string[], string, OverrideDecoder][] = [
  [["logging", "enabled"], "a boolean", readFlag],
  [["logging", "moduleTracking", "enabled"], "a boolean", readFlag],
  [["modules", "*", "optional"], "a boolean", readFlag],
  [["modules", "*", "source", "ignoreCache"], "a boolean", readFlag],
  [["modules", "*", "exportPriority", "*"], "a number", readNumber],
];

/**
 * Decodes an environment override's text for the field at `path`: a boolean
 * field takes exactly `true` or `false`, a number field finite numeric text,
 * and any other field the text itself. Throws an error naming the field when
 * the text does not decode.
 */
export function decodeOverride(path: string, text: string): OverrideValue {
  const segments = path.split(".");
  const typed = TYPED_OVERRIDES.find(
    ([pattern]) =>
      pattern.length === segments.length &&
      pattern.every((part, index) => part === "*" || part === segments[index]),
  );
  if (!typed) {
    return text;
  }
  const [, takes, decode] = typed;
  const read = decode(text);
  if (read === undefined) {
    throw configFieldError(path, takes, LOADER_CHANGE);
  }
  return read;
}

function checkProjectFields(
  value: unknown,
  loaded: LoadedConfig,
): asserts value is LoadedConfig {
  if (!isObject(value))
    throw new FieldError("project", "a project configuration");
  const checks: FieldChecks<LoadedConfig> = projectFields(loaded);
  checks.name(value.name, "name");
  checks.cacheFolder(value.cacheFolder, "cacheFolder");
  checks.modules(value.modules, "modules");
  checks.logging(value.logging, "logging");
  checks.envOverrides(value.envOverrides, "envOverrides");
  checks.test(value.test, "test");
}

type SetupHook = NonNullable<AntelopeTestConfig["setup"]>;
type CleanupHook = NonNullable<AntelopeTestConfig["cleanup"]>;

/** Whether a value is callable; the setup hook's result is read where it runs. */
function isSetupHook(value: unknown): value is SetupHook {
  return isFunction(value);
}

/** Whether a value is callable; the cleanup hook's result is awaited and dropped. */
function isCleanupHook(value: unknown): value is CleanupHook {
  return isFunction(value);
}

const testSectionContract = section<AntelopeTestConfig>("a test section", {
  folder: optional(text),
  setup: optional(leaf("a function", isSetupHook)),
  cleanup: optional(leaf("a function", isCleanupHook)),
});

const IMPORT_OVERRIDES_TAKE =
  "a list of import overrides or a map of interface names to module names";

const importOverrideList: FieldCheck<ImportOverride[]> = listOf(
  IMPORT_OVERRIDES_TAKE,
  importOverrideCheck,
);
const importOverrideMap: FieldCheck<Record<string, string>> = mapOf(
  IMPORT_OVERRIDES_TAKE,
  text,
);

const importOverridesContract: FieldCheck<
  AntelopeModuleConfig["importOverrides"]
> = (value, field) => {
  if (value === undefined) return;
  if (Array.isArray(value)) {
    importOverrideList(value, field);
  } else if (isObject(value)) {
    importOverrideMap(value, field);
  } else {
    throw new FieldError(field, IMPORT_OVERRIDES_TAKE);
  }
};

const moduleEntryContract: FieldCheck<ModuleEntryConfig> = section(
  "a module entry",
  {
    version: optional(text),
    source: optional(moduleSource),
    config: anyValue,
    importOverrides: importOverridesContract,
    disabledExports: optional(texts),
    exportPriority: optional(mapOf("a map of export priorities", number)),
    disabled: optional(flag),
    optional: optional(flag),
  },
);

const MODULE_TAKES = "a version string or a module entry";

const moduleContract: FieldCheck<string | AntelopeModuleConfig> = (
  value,
  field,
) => {
  if (isString(value)) return;
  if (!isObject(value)) throw new FieldError(field, MODULE_TAKES);
  moduleEntryContract(value, field);
};

const modulesContract: FieldCheck<AntelopeConfig["modules"]> = optional(
  mapOf("a map of module entries", moduleContract),
);

/**
 * Asserts that `value` holds the `modules` contract of a configuration file:
 * version strings, and entries with either form of `importOverrides`. Throws
 * the error {@link assertLoadedConfig} throws for `change`, naming the first
 * field that does not.
 */
export function assertConfigModules(
  value: unknown,
  change: ConfigChange,
): asserts value is AntelopeConfig["modules"] {
  reportFieldErrors(change, () => {
    modulesContract(value, "modules");
  });
}

function configContract(
  name: FieldCheck<string | undefined>,
): FieldChecks<Partial<AntelopeConfig>> {
  return {
    name,
    cacheFolder: optional(text),
    modules: modulesContract,
    logging: optional(loggingCheck),
    envOverrides: optional(mapOf("a map of environment overrides", textOrList)),
    environments: optional(
      mapOf("a map of environments", (value, field) => {
        environmentContract(value, field);
      }),
    ),
    test: optional(testSectionContract),
  };
}

const environmentContract: FieldCheck<Partial<AntelopeConfig>> = section(
  "an environment",
  configContract(optional(text)),
);

const projectContract: FieldCheck<AntelopeConfig> = section(
  "a project configuration",
  { ...configContract(text), name: text },
);

/**
 * Asserts that a configuration file's value holds the declared
 * `AntelopeConfig` contract, its `environments` included. A key the contract
 * does not declare is kept unchecked, and a module's `config` stays `unknown`.
 * Throws an error naming the first field that does not hold its declared type,
 * and the file it came from.
 */
export function assertAntelopeConfig(
  value: unknown,
  configPath: string,
): asserts value is AntelopeConfig {
  try {
    projectContract(value, "");
  } catch (error) {
    if (!(error instanceof FieldError)) throw error;
    throw new Error(
      `Configuration field '${error.field || "export"}' in ${configPath} does not hold ${error.takes}.`,
      { cause: error },
    );
  }
}

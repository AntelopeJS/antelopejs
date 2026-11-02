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
import {
  anyValue,
  asLoaded,
  type FieldCheck,
  FieldError,
  type FieldChecks,
  flag,
  isObject,
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

const testSection = section<AntelopeTestConfig>("a test section", {
  folder: optional(text),
  setup: asLoaded("the setup function the configuration file gave"),
  cleanup: asLoaded("the cleanup function the configuration file gave"),
});

const projectFields: FieldChecks<LoadedConfig> = {
  name: text,
  cacheFolder: text,
  modules: mapOf("a map of module entries", moduleEntry),
  logging: optional(loggingCheck),
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
  try {
    checkProjectFields(value, loaded);
  } catch (error) {
    if (!(error instanceof FieldError)) throw error;
    throw configFieldError(error.field, error.takes, error);
  }
}

function configFieldError(field: string, takes: string, cause?: Error) {
  return new Error(
    `Configuration field '${field}' does not hold ${takes} after templates and environment overrides.`,
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
    throw configFieldError(path, takes);
  }
  return read;
}

function checkProjectFields(
  value: unknown,
  loaded: LoadedConfig,
): asserts value is LoadedConfig {
  if (!isObject(value))
    throw new FieldError("project", "a project configuration");
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

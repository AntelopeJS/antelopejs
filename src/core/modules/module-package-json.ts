import { isObject, isString, type UnknownDictionary } from "../../utils";

/** The members of a module's `package.json` that the core reads. Other members are kept as written. */
export interface ModulePackageJson {
  name?: string;
  version?: string;
  description?: string;
  author?: string | string[];

  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;

  antelopeJs?: {
    implements?: string[];

    baseUrl?: string;
    paths?: Record<string, string[]>;

    moduleAliases?: Record<string, string>;

    /** Copied verbatim into a project's module configuration, whatever it holds. */
    defaultConfig?: unknown;

    configVars?: string[];

    /**
     * A file exporting `configVars(config)`, the pure function computing the
     * declared config variables from the module's configuration. Tools that
     * read a project without running it resolve `${@<module>.<VAR>}` with it;
     * the runtime still publishes through `provide`.
     */
    configVarsFile?: string;

    test?: string;
  };

  _moduleAliases?: Record<string, string>;
}

type ModuleAntelopeJsManifest = NonNullable<ModulePackageJson["antelopeJs"]>;

type MemberValue = UnknownDictionary[string];

function isStringList(value: MemberValue): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

/**
 * Reads the members of one manifest. A value the runtime has always refused is
 * refused here with the member's name; a value it has always ignored reads as
 * absent, so a manifest that starts today keeps starting.
 */
class ManifestReader {
  constructor(private readonly where: string) {}

  private refuse(member: string, expected: string): Error {
    return new Error(
      `Invalid module manifest in '${this.where}': ${member} must be ${expected}.`,
    );
  }

  name(value: MemberValue): string | undefined {
    if (value === undefined || isString(value)) {
      return value;
    }
    throw this.refuse("name", "a string");
  }

  dependencies(
    member: string,
    value: MemberValue,
  ): Record<string, string> | undefined {
    if (value === undefined || value === null || Array.isArray(value)) {
      return undefined;
    }
    if (!isObject(value)) {
      throw this.refuse(member, "an object");
    }
    const specs: Record<string, string> = {};
    for (const [name, spec] of Object.entries(value)) {
      if (!isString(spec)) {
        throw this.refuse(`${member}.${name}`, "a string");
      }
      specs[name] = spec;
    }
    return specs;
  }

  /**
   * An alias map. A string or a list of strings is read entry by entry, as
   * the runtime always has, so its indexes become alias names.
   */
  aliases(
    member: string,
    value: MemberValue,
  ): Record<string, string> | undefined {
    if (isString(value) || isStringList(value)) {
      return Object.fromEntries(Object.entries(value));
    }
    if (!isObject(value)) {
      if (Array.isArray(value)) {
        throw this.refuse(member, "an object of strings");
      }
      return undefined;
    }
    const aliases: Record<string, string> = {};
    for (const [alias, target] of Object.entries(value)) {
      if (!isString(target)) {
        throw this.refuse(`${member}.${alias}`, "a string");
      }
      aliases[alias] = target;
    }
    return aliases;
  }

  /**
   * The implemented interfaces. A string is read character by character, as
   * the runtime always has; an entry that is not a string names no interface.
   */
  implements(value: MemberValue): string[] | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (isString(value)) {
      return Array.from(value);
    }
    if (!Array.isArray(value)) {
      throw this.refuse("antelopeJs.implements", "a list of strings");
    }
    return value.filter(isString);
  }

  baseUrl(value: MemberValue): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (!isString(value)) {
      throw this.refuse("antelopeJs.baseUrl", "a string");
    }
    return value;
  }

  paths(value: MemberValue): Record<string, string[]> | undefined {
    if (isObject(value)) {
      const paths: Record<string, string[]> = {};
      for (const [key, targets] of Object.entries(value)) {
        if (!isStringList(targets)) {
          throw this.refuse(`antelopeJs.paths.${key}`, "a list of strings");
        }
        paths[key] = targets;
      }
      return paths;
    }
    if (
      (isString(value) && value !== "") ||
      (Array.isArray(value) && value.length > 0)
    ) {
      throw this.refuse("antelopeJs.paths", "an object of string lists");
    }
    return undefined;
  }

  configVars(value: MemberValue): string[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }
    if (!isStringList(value)) {
      throw this.refuse("antelopeJs.configVars", "a list of strings");
    }
    return value;
  }

  antelopeJs(value: MemberValue): ModuleAntelopeJsManifest | undefined {
    if (!isObject(value)) {
      return undefined;
    }
    return {
      ...value,
      implements: this.implements(value.implements),
      baseUrl: this.baseUrl(value.baseUrl),
      paths: this.paths(value.paths),
      moduleAliases: this.aliases(
        "antelopeJs.moduleAliases",
        value.moduleAliases,
      ),
      configVars: this.configVars(value.configVars),
      configVarsFile: isString(value.configVarsFile)
        ? value.configVarsFile
        : undefined,
      test: isString(value.test) ? value.test : undefined,
    };
  }
}

/**
 * Decodes a module's `package.json`, keeping the members the core does not read.
 *
 * `name` and `version` may be missing, and a `version` that is not a string
 * reads as missing: npm does not validate the package.json of a tarball it
 * downloads, and such a module starts. When the module has an
 * `antelope.module.json`, its content replaces the `antelopeJs` member.
 *
 * @param packageJsonText - The text of `package.json`.
 * @param where - The folder named by a refusal.
 * @param antelopeModuleJsonText - The text of `antelope.module.json`, when present.
 */
export function decodeModulePackageJson(
  packageJsonText: string,
  where: string,
  antelopeModuleJsonText?: string,
): ModulePackageJson {
  const parsed: unknown = JSON.parse(packageJsonText);
  const antelopeJs: unknown =
    antelopeModuleJsonText === undefined
      ? undefined
      : JSON.parse(antelopeModuleJsonText);
  const document: unknown =
    antelopeModuleJsonText === undefined
      ? parsed
      : Object.assign({}, parsed, { antelopeJs });
  if (!isObject(document)) {
    throw new Error(
      `Invalid module manifest in '${where}': the file must hold a JSON object.`,
    );
  }
  const reader = new ManifestReader(where);
  return {
    ...document,
    name: reader.name(document.name),
    version: isString(document.version) ? document.version : undefined,
    description: isString(document.description)
      ? document.description
      : undefined,
    author:
      isString(document.author) || isStringList(document.author)
        ? document.author
        : undefined,
    dependencies: reader.dependencies("dependencies", document.dependencies),
    optionalDependencies: reader.dependencies(
      "optionalDependencies",
      document.optionalDependencies,
    ),
    antelopeJs: reader.antelopeJs(document.antelopeJs),
    _moduleAliases: reader.aliases("_moduleAliases", document._moduleAliases),
  };
}

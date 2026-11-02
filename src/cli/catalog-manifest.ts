import type { ModuleSource } from "@antelopejs/interface-core/config";

import {
  type NextStep,
  PACKAGE_MANAGER_NAMES,
  type PackageManagerName,
} from "../core/output";
import { isObject, isString, type UnknownDictionary } from "../utils";

/** The `manifest.json` at the root of a template and interface catalog repository. */
export interface GitManifest {
  interfaces?: Record<string, string>;
  starredInterfaces?: string[];
  templates?: Template[];
  projectTemplates?: Template[];
}

export interface Template {
  name: string;
  repository: string;
  branch: string;
  description?: string;
  packageManager?: PackageManagerName;
  nextSteps?: NextStep[];
}

/** The `manifest.json` of one interface in a catalog repository. */
export interface InterfaceManifest {
  description?: string;
  package?: string;
  modules?: ModuleInterfaceInfo[];
}

export interface ModuleInterfaceInfo {
  name: string;
  source: ModuleSource;
}

const MODULE_SOURCE_TYPES: readonly ModuleSource["type"][] = [
  "local",
  "git",
  "package",
  "local-folder",
];

type MemberValue = UnknownDictionary[string];

function isModuleSourceType(value: MemberValue): value is ModuleSource["type"] {
  return MODULE_SOURCE_TYPES.some((type) => type === value);
}

function isPackageManagerName(value: MemberValue): value is PackageManagerName {
  return PACKAGE_MANAGER_NAMES.some((name) => name === value);
}

class CatalogReader {
  constructor(private readonly where: string) {}

  refuse(member: string, expected: string): Error {
    return new Error(
      `Invalid catalog manifest '${this.where}': ${member} must be ${expected}.`,
    );
  }

  optionalString(member: string, value: MemberValue): string | undefined {
    if (value === undefined || isString(value)) {
      return value;
    }
    throw this.refuse(member, "a string");
  }

  string(member: string, value: MemberValue): string {
    if (!isString(value)) {
      throw this.refuse(member, "a string");
    }
    return value;
  }

  list<T>(
    member: string,
    value: MemberValue,
    item: (entry: MemberValue, at: string) => T,
  ): T[] | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (!Array.isArray(value)) {
      throw this.refuse(member, "a list");
    }
    return value.map((entry, index) => item(entry, `${member}[${index}]`));
  }

  object(member: string, value: MemberValue): UnknownDictionary {
    if (!isObject(value)) {
      throw this.refuse(member, "an object");
    }
    return value;
  }

  /**
   * The interface folders by package name. A value that is not an object
   * names no interface package, as indexing it never did.
   */
  interfaceFolders(value: MemberValue): Record<string, string> | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      throw this.refuse("interfaces", "an object");
    }
    if (!isObject(value)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value).map(([name, folder]) => [
        name,
        this.string(`interfaces.${name}`, folder),
      ]),
    );
  }

  nextStep(value: MemberValue, at: string): NextStep {
    const step = this.object(at, value);
    return {
      command: this.string(`${at}.command`, step.command),
      description: this.optionalString(`${at}.description`, step.description),
    };
  }

  template(value: MemberValue, at: string): Template {
    const template = this.object(at, value);
    const { packageManager } = template;
    if (packageManager !== undefined && !isPackageManagerName(packageManager)) {
      throw this.refuse(
        `${at}.packageManager`,
        `one of ${PACKAGE_MANAGER_NAMES.join(", ")}`,
      );
    }
    return {
      name: this.string(`${at}.name`, template.name),
      repository: this.string(`${at}.repository`, template.repository),
      branch: this.string(`${at}.branch`, template.branch),
      description: this.optionalString(
        `${at}.description`,
        template.description,
      ),
      packageManager,
      nextSteps: this.list(`${at}.nextSteps`, template.nextSteps, (step, i) =>
        this.nextStep(step, i),
      ),
    };
  }

  module(value: MemberValue, at: string): ModuleInterfaceInfo {
    const entry = this.object(at, value);
    const source = this.object(`${at}.source`, entry.source);
    const { type } = source;
    if (!isModuleSourceType(type)) {
      throw this.refuse(
        `${at}.source.type`,
        `one of ${MODULE_SOURCE_TYPES.join(", ")}`,
      );
    }
    return {
      name: this.string(`${at}.name`, entry.name),
      source: {
        ...source,
        type,
        id: this.optionalString(`${at}.source.id`, source.id),
      },
    };
  }
}

/**
 * Decodes a catalog's root `manifest.json`. Each member may be missing: the
 * command that reads it refuses the catalog then.
 *
 * @param text - The text of the file.
 * @param where - The file named by a refusal.
 */
export function decodeGitManifest(text: string, where: string): GitManifest {
  const reader = new CatalogReader(where);
  const manifest = reader.object("the file", JSON.parse(text));
  return {
    interfaces: reader.interfaceFolders(manifest.interfaces),
    starredInterfaces: reader.list(
      "starredInterfaces",
      manifest.starredInterfaces,
      (entry, at) => reader.string(at, entry),
    ),
    templates: reader.list("templates", manifest.templates, (entry, at) =>
      reader.template(entry, at),
    ),
    projectTemplates: reader.list(
      "projectTemplates",
      manifest.projectTemplates,
      (entry, at) => reader.template(entry, at),
    ),
  };
}

/**
 * Decodes the `manifest.json` of one interface of a catalog. Content that is
 * not an object lists no implementations.
 *
 * @param text - The text of the file.
 * @param where - The file named by a refusal.
 */
export function decodeInterfaceManifest(
  text: string,
  where: string,
): InterfaceManifest {
  const reader = new CatalogReader(where);
  const document: unknown = JSON.parse(text);
  if (!isObject(document)) {
    return {};
  }
  return {
    description: isString(document.description)
      ? document.description
      : undefined,
    package: isString(document.package) ? document.package : undefined,
    modules:
      document.modules === null
        ? undefined
        : reader.list("modules", document.modules, (entry, at) =>
            reader.module(entry, at),
          ),
  };
}

/**
 * The member a command reads, refused when the catalog leaves it out.
 *
 * @param where - The catalog file, as named by the refusal.
 */
export function requireCatalogMember<K extends keyof GitManifest>(
  manifest: GitManifest,
  member: K,
  where: string,
): NonNullable<GitManifest[K]> {
  const value = manifest[member];
  if (value === undefined) {
    throw new CatalogReader(where).refuse(member, "present");
  }
  return value;
}

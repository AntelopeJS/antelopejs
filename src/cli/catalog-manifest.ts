import type { ModuleSource } from "@antelopejs/interface-core/config";

import {
  type NextStep,
  PACKAGE_MANAGER_NAMES,
  type PackageManagerName,
} from "../core/output";
import { isObject, isString } from "../utils";

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

interface RawGitManifest {
  interfaces?: unknown;
  starredInterfaces?: unknown;
  templates?: unknown;
  projectTemplates?: unknown;
}

interface RawTemplate {
  name?: unknown;
  repository?: unknown;
  branch?: unknown;
  description?: unknown;
  packageManager?: unknown;
  nextSteps?: unknown;
}

interface RawNextStep {
  command?: unknown;
  description?: unknown;
}

interface RawModuleEntry {
  name?: unknown;
  source?: unknown;
}

function isModuleSourceType(value: unknown): value is ModuleSource["type"] {
  return MODULE_SOURCE_TYPES.some((type) => type === value);
}

function isPackageManagerName(value: unknown): value is PackageManagerName {
  return PACKAGE_MANAGER_NAMES.some((name) => name === value);
}

class CatalogReader {
  constructor(private readonly where: string) {}

  refuse(member: string, expected: string): Error {
    return new Error(
      `Invalid catalog manifest '${this.where}': ${member} must be ${expected}.`,
    );
  }

  optionalString(
    member: string,
    value: unknown,
  ): asserts value is string | undefined {
    if (value !== undefined && !isString(value)) {
      throw this.refuse(member, "a string");
    }
  }

  string(member: string, value: unknown): asserts value is string {
    if (!isString(value)) {
      throw this.refuse(member, "a string");
    }
  }

  list(member: string, value: unknown): asserts value is unknown[] | undefined {
    if (value !== undefined && !Array.isArray(value)) {
      throw this.refuse(member, "a list");
    }
  }

  object(member: string, value: unknown): asserts value is object {
    if (!isObject(value)) {
      throw this.refuse(member, "an object");
    }
  }

  /**
   * The interface folders by package name. A value that is not an object
   * names no interface package, as indexing it never did.
   */
  interfaceFolders(
    manifest: RawGitManifest,
  ): Record<string, string> | undefined {
    const value = manifest.interfaces;
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
      Object.entries(value).map(([name, folder]) => {
        this.string(`interfaces.${name}`, folder);
        return [name, folder];
      }),
    );
  }

  starredInterfaces(manifest: RawGitManifest): string[] | undefined {
    const value = manifest.starredInterfaces;
    this.list("starredInterfaces", value);
    return value?.map((entry, index) => {
      this.string(`starredInterfaces[${index}]`, entry);
      return entry;
    });
  }

  templates(
    member: "templates" | "projectTemplates",
    manifest: RawGitManifest,
  ): Template[] | undefined {
    const value = manifest[member];
    this.list(member, value);
    return value?.map((entry, index) => {
      const at = `${member}[${index}]`;
      this.object(at, entry);
      return this.template(at, entry);
    });
  }

  nextStep(at: string, step: RawNextStep): NextStep {
    this.string(`${at}.command`, step.command);
    this.optionalString(`${at}.description`, step.description);
    return { command: step.command, description: step.description };
  }

  template(at: string, template: RawTemplate): Template {
    if (
      template.packageManager !== undefined &&
      !isPackageManagerName(template.packageManager)
    ) {
      throw this.refuse(
        `${at}.packageManager`,
        `one of ${PACKAGE_MANAGER_NAMES.join(", ")}`,
      );
    }
    this.string(`${at}.name`, template.name);
    this.string(`${at}.repository`, template.repository);
    this.string(`${at}.branch`, template.branch);
    this.optionalString(`${at}.description`, template.description);
    const nextSteps = template.nextSteps;
    this.list(`${at}.nextSteps`, nextSteps);
    return {
      name: template.name,
      repository: template.repository,
      branch: template.branch,
      description: template.description,
      packageManager: template.packageManager,
      nextSteps: nextSteps?.map((step, index) => {
        const stepAt = `${at}.nextSteps[${index}]`;
        this.object(stepAt, step);
        return this.nextStep(stepAt, step);
      }),
    };
  }

  module(at: string, entry: RawModuleEntry): ModuleInterfaceInfo {
    const { source } = entry;
    if (!isObject(source)) {
      throw this.refuse(`${at}.source`, "an object");
    }
    if (!isModuleSourceType(source.type)) {
      throw this.refuse(
        `${at}.source.type`,
        `one of ${MODULE_SOURCE_TYPES.join(", ")}`,
      );
    }
    this.string(`${at}.name`, entry.name);
    this.optionalString(`${at}.source.id`, source.id);
    return {
      name: entry.name,
      source: { ...source, type: source.type, id: source.id },
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
  const reader: CatalogReader = new CatalogReader(where);
  const manifest: unknown = JSON.parse(text);
  reader.object("the file", manifest);
  return {
    interfaces: reader.interfaceFolders(manifest),
    starredInterfaces: reader.starredInterfaces(manifest),
    templates: reader.templates("templates", manifest),
    projectTemplates: reader.templates("projectTemplates", manifest),
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
  const reader: CatalogReader = new CatalogReader(where);
  const document: unknown = JSON.parse(text);
  if (!isObject(document)) {
    return {};
  }
  const { modules } = document;
  if (modules !== null) {
    reader.list("modules", modules);
  }
  return {
    description: isString(document.description)
      ? document.description
      : undefined,
    package: isString(document.package) ? document.package : undefined,
    modules:
      modules === null
        ? undefined
        : modules?.map((entry, index) => {
            const at = `modules[${index}]`;
            reader.object(at, entry);
            return reader.module(at, entry);
          }),
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

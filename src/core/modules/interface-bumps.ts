import type {
  ModuleSource,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";
import path from "node:path";
import { lt, prerelease, valid, validRange } from "semver";

import { isString, resolvePackage } from "../../utils";
import { normalizeExistingPath } from "../../utils/package-resolution";
import { satisfiesRange } from "../../version-ranges";

import { INTERFACE_CORE_PACKAGE } from "./module-manager-bindings";
import type {
  InterfacePackageConsumer,
  InterfacePackagePlan,
  ManagedModule,
} from "./module-manager-context";
import type { ModuleManifest } from "./module-manifest";

/** The package.json field a module declares an interface package in. */
type DependencyField = "dependencies" | "optionalDependencies";

interface BumpBase {
  moduleId: string;
  packageName: string;
  /** The version of the module's copy now. */
  current: string;
  /** The highest installed version every module's range accepts. */
  target: string;
  /** The modules whose range excludes the module's copy, as `id@version`. */
  requiredBy: string[];
  /** True when a launch fails until the bump is applied. */
  required: boolean;
}

/**
 * A module whose package.json the project owns raises the floor of its range,
 * then installs its dependencies again.
 */
export interface RangeBump extends BumpBase {
  kind: "range";
  folder: string;
  field: DependencyField;
  from: string;
  to: string;
}

/**
 * An npm module resolves its dependencies again, as `modules update` does,
 * so its recorded lock picks the target version its own range already accepts.
 */
export interface RelockBump extends BumpBase {
  kind: "relock";
  source: ModuleSourcePackage;
}

/**
 * A local module the project installs under `node_modules`: its package.json
 * belongs to a dependency of the project, which the next install overwrites,
 * so the project raises that dependency to a release on the target instead.
 */
export interface DependencyBump extends BumpBase {
  kind: "dependency";
  folder: string;
  /** The package under the outermost `node_modules` holding the module. */
  dependency: string;
  /** The folder whose `node_modules` holds `dependency`. */
  project: string;
}

/**
 * A change that gives a module the copy of an interface package every module
 * accepts.
 */
export type InterfaceBump = RangeBump | RelockBump | DependencyBump;

const LOCAL_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "local",
  "local-folder",
]);
const NODE_MODULES = "node_modules";
const FLOOR_RANGE_PATTERN = /^>=\s*(\S+)(\s+<\s*\S+)?$/;
const PREFIX_RANGE_PATTERN = /^([\^~]?)(\S+)$/;
const CORE_INTERFACE_COPY = resolvePackage(
  INTERFACE_CORE_PACKAGE,
  __dirname,
)?.version;

function packageSource(source: ModuleSource): ModuleSourcePackage | undefined {
  if (
    source.type !== "package" ||
    !("package" in source && isString(source.package)) ||
    !("version" in source && isString(source.version))
  ) {
    return undefined;
  }
  return {
    ...source,
    type: "package",
    package: source.package,
    version: source.version,
  };
}

/**
 * The project and the dependency that install `folder`, read from its real
 * path: a folder whose real path lies outside every `node_modules` (a
 * workspace package linked into one) belongs to the project. The project is
 * the folder holding the outermost `node_modules`; the dependency is the
 * package under the innermost one, which names the real package inside a
 * `.pnpm` store.
 *
 * @returns undefined when the real path of `folder` lies under no
 * `node_modules`.
 */
function installingDependency(
  folder: string,
): { project: string; dependency: string } | undefined {
  const segments = normalizeExistingPath(folder).split(path.sep);
  const first = segments.indexOf(NODE_MODULES);
  const last = segments.lastIndexOf(NODE_MODULES);
  if (first < 0 || last + 1 >= segments.length) {
    return undefined;
  }
  const nameLength = segments[last + 1]?.startsWith("@") ? 2 : 1;
  return {
    project: segments.slice(0, first).join(path.sep) || path.sep,
    dependency: segments
      .slice(last + 1, last + 1 + nameLength)
      .join(path.posix.sep),
  };
}

function acceptsVersion(range: string, version: string): boolean {
  const parsed = validRange(range);
  return !parsed || satisfiesRange(version, parsed);
}

/**
 * `range` with its floor raised to `version`, keeping its shape: `>=a <b`
 * keeps its cap, `^a` and `~a` keep their prefix, and an exact version is
 * replaced. A prerelease `version` replaces the range whatever its shape, so
 * the module pins the preview it was raised to. Any other spec, such as an `npm:` alias, a `workspace:` or
 * `file:` link, a dist-tag or a union, has no floor to raise.
 *
 * @returns undefined when the spec has no floor to raise.
 */
export function raiseRangeFloor(
  range: string,
  version: string,
): string | undefined {
  const trimmed = range.trim();
  const floor = FLOOR_RANGE_PATTERN.exec(trimmed);
  const prefixed = PREFIX_RANGE_PATTERN.exec(trimmed);
  let raised: string | undefined;
  if (floor && valid(floor[1])) {
    raised = `>=${version}${floor[2] ?? ""}`;
  } else if (prefixed && valid(prefixed[2])) {
    raised = `${prefixed[1]}${version}`;
  }
  if (raised !== undefined && prerelease(version)) {
    raised = version;
  }
  return raised !== undefined && acceptsVersion(raised, version)
    ? raised
    : undefined;
}

/**
 * The installed versions of `packageName` a module may be raised to. Every
 * module loads the core's own copy of `@antelopejs/interface-core`, so that
 * copy is its only candidate: a newer one declares handlers the core lacks.
 */
function candidateVersions(
  packageName: string,
  plan: InterfacePackagePlan,
): (string | undefined)[] {
  if (packageName === INTERFACE_CORE_PACKAGE) {
    return [CORE_INTERFACE_COPY];
  }
  return [
    plan.canonicalPackage.version,
    ...plan.consumers.map((consumer) => consumer.resolvedPackage?.version),
  ];
}

/**
 * The highest candidate version of an interface package that every
 * consumer's range accepts.
 */
function findTargetVersion(
  packageName: string,
  plan: InterfacePackagePlan,
): string | undefined {
  const versions = candidateVersions(packageName, plan).flatMap((version) => {
    const parsed = valid(version);
    return parsed ? [parsed] : [];
  });
  return versions
    .filter((version) =>
      plan.consumers.every((consumer) =>
        acceptsVersion(consumer.range, version),
      ),
    )
    .sort((left, right) => (lt(left, right) ? 1 : -1))[0];
}

function describeModule(manifest: ModuleManifest | undefined, id: string) {
  return manifest?.version ? `${id}@${manifest.version}` : id;
}

function dependencyField(
  manifest: ModuleManifest,
  packageName: string,
): DependencyField {
  const dependencies = manifest.manifest.dependencies;
  return dependencies && Object.hasOwn(dependencies, packageName)
    ? "dependencies"
    : "optionalDependencies";
}

interface BumpContext {
  packageName: string;
  plan: InterfacePackagePlan;
  target: string;
  required: boolean;
  modules: ReadonlyMap<string, ModuleManifest>;
}

function requiredBy(context: BumpContext, current: string): string[] {
  return context.plan.consumers
    .filter((consumer) => !acceptsVersion(consumer.range, current))
    .map((consumer) =>
      describeModule(context.modules.get(consumer.moduleId), consumer.moduleId),
    );
}

function isProviderCopy(
  plan: InterfacePackagePlan,
  consumer: InterfacePackageConsumer,
): boolean {
  return (
    consumer.moduleId === plan.provider &&
    consumer.resolvedPackage?.realRoot === plan.canonicalPackage.realRoot
  );
}

function bumpConsumer(
  context: BumpContext,
  consumer: InterfacePackageConsumer,
): InterfaceBump[] {
  const manifest = context.modules.get(consumer.moduleId);
  const current = valid(consumer.resolvedPackage?.version);
  if (!manifest || !current || !lt(current, context.target)) {
    return [];
  }
  const base: BumpBase = {
    moduleId: consumer.moduleId,
    packageName: context.packageName,
    current,
    target: context.target,
    requiredBy: requiredBy(context, current),
    required: context.required,
  };
  if (LOCAL_SOURCE_TYPES.has(manifest.source.type)) {
    const installed = installingDependency(manifest.folder);
    if (installed) {
      return [
        { ...base, kind: "dependency", folder: manifest.folder, ...installed },
      ];
    }
    const to = raiseRangeFloor(consumer.range, context.target);
    return to === undefined
      ? []
      : [
          {
            ...base,
            kind: "range",
            folder: normalizeExistingPath(manifest.folder),
            field: dependencyField(manifest, context.packageName),
            from: consumer.range,
            to,
          },
        ];
  }
  const source = packageSource(manifest.source);
  if (source && isProviderCopy(context.plan, consumer)) {
    return [{ ...base, kind: "relock", source }];
  }
  return [];
}

/**
 * Lists the changes that give every module the copy of `packageName` that
 * all their ranges accept. A module the project owns (a local folder) whose
 * copy is older raises its range; one whose folder lies under `node_modules`
 * names the project dependency to raise instead. An npm module whose older
 * copy is the shared one resolves its dependencies again. Other npm modules are left
 * alone: a launch redirects them to the shared copy. Nothing is listed when
 * no installed copy satisfies every range.
 *
 * @param modules the manifest of each loaded module, by module id.
 */
function findInterfaceBumps(
  packageName: string,
  plan: InterfacePackagePlan,
  modules: ReadonlyMap<string, ModuleManifest>,
): InterfaceBump[] {
  const target = findTargetVersion(packageName, plan);
  if (!target) {
    return [];
  }
  const canonical = plan.canonicalPackage.version;
  const context: BumpContext = {
    packageName,
    plan,
    target,
    required: plan.consumers.some(
      (consumer) => !canonical || !acceptsVersion(consumer.range, canonical),
    ),
    modules,
  };
  return plan.consumers.flatMap((consumer) => bumpConsumer(context, consumer));
}

/**
 * Lists the {@link InterfaceBump}s of every planned interface package. Reads
 * only package.json files, so it runs before any module code is loaded.
 *
 * @param modules every module the plans were made for.
 */
export function listBumps(
  plans: ReadonlyMap<string, InterfacePackagePlan>,
  modules: readonly ManagedModule[],
): InterfaceBump[] {
  const manifests = new Map(
    modules.map(({ module }) => [module.id, module.manifest]),
  );
  return [...plans].flatMap(([packageName, plan]) =>
    findInterfaceBumps(packageName, plan, manifests),
  );
}

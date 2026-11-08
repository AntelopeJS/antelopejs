import type {
  ModuleSource,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";
import { lt, satisfies, valid, validRange } from "semver";

import { isString } from "../../utils";

import type {
  InterfacePackageConsumer,
  InterfacePackagePlan,
  ManagedModule,
} from "./module-manager-context";
import type { ModuleManifest } from "./module-manifest";

/** The package.json field a module declares an interface package in. */
export type DependencyField = "dependencies" | "optionalDependencies";

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
 * A change that gives a module the copy of an interface package every module
 * accepts.
 */
export type InterfaceBump = RangeBump | RelockBump;

const LOCAL_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "local",
  "local-folder",
]);
const FLOOR_RANGE_PATTERN = /^>=\s*\S+(\s+<\s*\S+)?$/;
const PREFIX_RANGE_PATTERN = /^[\^~]?/;
const CARET = "^";

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

function acceptsVersion(range: string, version: string): boolean {
  const parsed = validRange(range);
  return !parsed || satisfies(version, parsed);
}

/**
 * `range` with its floor raised to `version`, keeping its shape: `>=a <b`
 * keeps its cap, `^a` and `~a` keep their prefix. Any other range becomes
 * `^version`.
 */
export function raiseRangeFloor(range: string, version: string): string {
  const trimmed = range.trim();
  const floor = FLOOR_RANGE_PATTERN.exec(trimmed);
  const prefix = PREFIX_RANGE_PATTERN.exec(trimmed)?.[0] ?? "";
  const candidates = [
    floor ? `>=${version}${floor[1] ?? ""}` : undefined,
    valid(trimmed.slice(prefix.length)) ? `${prefix}${version}` : undefined,
  ];
  return (
    candidates.find(
      (candidate) =>
        candidate !== undefined && acceptsVersion(candidate, version),
    ) ?? `${CARET}${version}`
  );
}

/**
 * The highest version among the installed copies of an interface package
 * that every consumer's range accepts.
 */
function findTargetVersion(plan: InterfacePackagePlan): string | undefined {
  const versions = [
    plan.canonicalPackage.version,
    ...plan.consumers.map((consumer) => consumer.resolvedPackage?.version),
  ].flatMap((version) => {
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
  return manifest.manifest.dependencies?.[packageName] !== undefined
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
    return [
      {
        ...base,
        kind: "range",
        folder: manifest.folder,
        field: dependencyField(manifest, context.packageName),
        from: consumer.range,
        to: raiseRangeFloor(consumer.range, context.target),
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
 * copy is older raises its range; an npm module whose older copy is the
 * shared one resolves its dependencies again. Other npm modules are left
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
  const target = findTargetVersion(plan);
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
 * Lists the {@link InterfaceBump}s of every planned interface package.
 *
 * @param modules every module the plans were made for.
 */
export function findPlannedBumps(
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

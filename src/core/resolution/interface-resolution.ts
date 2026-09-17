import { resolvePackage } from "./package-resolution";

export interface InterfaceProvider {
  /**
   * Package name of the runtime module, when known. A package loaded as a
   * module of the project is never an interface package, whatever its
   * manifest looks like: depending on it is a plain package dependency.
   */
  name?: string;
  implements: string[];
  disabledExports?: Set<string>;
}

export interface InterfaceConsumer {
  id: string;
  folder: string;
  dependencies: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export interface UnresolvedInterface {
  moduleId: string;
  interfacePackage: string;
  /**
   * True when the interface package declares `antelopeJs.standalone`. Carried
   * on stubbed entries so the runtime can log a standalone (expected) message
   * rather than an optional-dependency warning. Has no effect on `unresolved`.
   */
  standalone?: boolean;
}

interface InterfacePackageInfo {
  isInterface: boolean;
  standalone: boolean;
}

export interface InterfaceResolutionResult {
  unresolved: UnresolvedInterface[];
  stubbed: UnresolvedInterface[];
}

const NOT_AN_INTERFACE: InterfacePackageInfo = {
  isInterface: false,
  standalone: false,
};

/**
 * Tells an interface package from a runtime module by the shape of its
 * `antelopeJs` manifest key.
 *
 * Both kinds carry that key, so its mere presence says nothing. What
 * separates them is `implements`: a package that declares which interfaces it
 * implements is a runtime module — it is loaded, started and stopped, and
 * other packages depend on it the way they depend on any library. An
 * interface package implements nothing; it only describes a contract.
 *
 * The one crossover is a package that lists ITSELF in `implements`: a runtime
 * module that also ships its own interface (the lifecycle-interface pattern
 * the resolver tracks in `lifecycleInterfacePackages`). That one is both, and
 * still counts as an interface package here.
 */
function isInterfacePackageManifest(
  packageName: string,
  antelopeJs: Record<string, unknown>,
): boolean {
  const implemented = antelopeJs.implements;
  if (!Array.isArray(implemented) || implemented.length === 0) {
    return true;
  }
  return implemented.every((name) => name === packageName);
}

function readInterfacePackageInfo(
  dep: string,
  consumerFolder: string,
  modulePackages: ReadonlySet<string>,
): InterfacePackageInfo {
  if (modulePackages.has(dep)) {
    return NOT_AN_INTERFACE;
  }
  const resolvedPackage = resolvePackage(dep, consumerFolder);
  if (!resolvedPackage?.antelopeJs) {
    return NOT_AN_INTERFACE;
  }
  if (!isInterfacePackageManifest(dep, resolvedPackage.antelopeJs)) {
    return NOT_AN_INTERFACE;
  }
  return {
    isInterface: true,
    standalone: Boolean(resolvedPackage.antelopeJs.standalone),
  };
}

export function findUnresolvedInterfaces(
  providers: InterfaceProvider[],
  consumers: InterfaceConsumer[],
  knownResolved?: Iterable<string>,
): InterfaceResolutionResult {
  const implementedInterfaces = new Set<string>(knownResolved);
  for (const provider of providers) {
    for (const iface of provider.implements) {
      if (!provider.disabledExports?.has(iface)) {
        implementedInterfaces.add(iface);
      }
    }
  }

  const modulePackages = new Set(
    providers.flatMap((provider) => (provider.name ? [provider.name] : [])),
  );

  const unresolved: UnresolvedInterface[] = [];
  const stubbed: UnresolvedInterface[] = [];
  for (const consumer of consumers) {
    for (const dep of Object.keys(consumer.dependencies)) {
      if (implementedInterfaces.has(dep)) continue;
      const info = readInterfacePackageInfo(
        dep,
        consumer.folder,
        modulePackages,
      );
      if (!info.isInterface) continue;
      // A standalone interface with no implementer self-hosts instead of
      // blocking startup — route it through the stub/self-host path.
      if (info.standalone) {
        stubbed.push({
          moduleId: consumer.id,
          interfacePackage: dep,
          standalone: true,
        });
      } else {
        unresolved.push({ moduleId: consumer.id, interfacePackage: dep });
      }
    }

    const optional = consumer.optionalDependencies ?? {};
    for (const dep of Object.keys(optional)) {
      if (implementedInterfaces.has(dep)) continue;
      const info = readInterfacePackageInfo(
        dep,
        consumer.folder,
        modulePackages,
      );
      if (!info.isInterface) continue;
      stubbed.push({
        moduleId: consumer.id,
        interfacePackage: dep,
        standalone: info.standalone,
      });
    }
  }

  return { unresolved, stubbed };
}

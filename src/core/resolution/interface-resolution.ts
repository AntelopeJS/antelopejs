import { readFileSync } from "node:fs";

export interface InterfaceProvider {
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

function readInterfacePackageInfo(
  dep: string,
  consumerFolder: string,
): InterfacePackageInfo {
  try {
    const pkgJsonPath = require.resolve(`${dep}/package.json`, {
      paths: [consumerFolder],
    });
    const depPkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    const antelopeJs = depPkg.antelopeJs;
    return {
      isInterface: Boolean(antelopeJs),
      standalone: Boolean(antelopeJs?.standalone),
    };
  } catch {
    return { isInterface: false, standalone: false };
  }
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

  const unresolved: UnresolvedInterface[] = [];
  const stubbed: UnresolvedInterface[] = [];
  for (const consumer of consumers) {
    for (const dep of Object.keys(consumer.dependencies)) {
      if (implementedInterfaces.has(dep)) continue;
      const info = readInterfacePackageInfo(dep, consumer.folder);
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
      const info = readInterfacePackageInfo(dep, consumer.folder);
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

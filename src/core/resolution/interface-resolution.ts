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
}

export interface InterfaceResolutionResult {
  unresolved: UnresolvedInterface[];
  stubbed: UnresolvedInterface[];
}

function isInterfacePackage(dep: string, consumerFolder: string): boolean {
  try {
    const pkgJsonPath = require.resolve(`${dep}/package.json`, {
      paths: [consumerFolder],
    });
    const depPkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    return Boolean(depPkg.antelopeJs);
  } catch {
    return false;
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
      if (!isInterfacePackage(dep, consumer.folder)) continue;
      unresolved.push({ moduleId: consumer.id, interfacePackage: dep });
    }

    const optional = consumer.optionalDependencies ?? {};
    for (const dep of Object.keys(optional)) {
      if (implementedInterfaces.has(dep)) continue;
      if (!isInterfacePackage(dep, consumer.folder)) continue;
      stubbed.push({ moduleId: consumer.id, interfacePackage: dep });
    }
  }

  return { unresolved, stubbed };
}

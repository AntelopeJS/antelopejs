import { readFileSync } from "node:fs";

export interface InterfaceProvider {
  implements: string[];
  disabledExports?: Set<string>;
}

export interface InterfaceConsumer {
  id: string;
  folder: string;
  dependencies: Record<string, string>;
}

export interface UnresolvedInterface {
  moduleId: string;
  interfacePackage: string;
}

export function findUnresolvedInterfaces(
  providers: InterfaceProvider[],
  consumers: InterfaceConsumer[],
  knownResolved?: Iterable<string>,
): UnresolvedInterface[] {
  const implementedInterfaces = new Set<string>(knownResolved);
  for (const provider of providers) {
    for (const iface of provider.implements) {
      if (!provider.disabledExports?.has(iface)) {
        implementedInterfaces.add(iface);
      }
    }
  }

  const unresolved: UnresolvedInterface[] = [];
  for (const consumer of consumers) {
    for (const dep of Object.keys(consumer.dependencies)) {
      if (implementedInterfaces.has(dep)) continue;
      try {
        const pkgJsonPath = require.resolve(`${dep}/package.json`, {
          paths: [consumer.folder],
        });
        const depPkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
        if (depPkg.antelopeJs) {
          unresolved.push({ moduleId: consumer.id, interfacePackage: dep });
        }
      } catch {
        // Not resolvable — not an interface package
      }
    }
  }

  return unresolved;
}

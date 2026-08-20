import {
  GetInterfaceProxyIdentity,
  IsInterfaceProxy,
} from "@antelopejs/interface-core";

export interface InterfaceProviderRoute {
  interfaceName: string;
  packageEntry?: string;
  provider: string;
  providerCount: number;
}

function collectProxyIdentities(value: unknown): string[] {
  const identities = new Set<string>();
  const visited = new WeakSet<object>();

  const visit = (candidate: unknown): void => {
    if (
      (typeof candidate !== "object" && typeof candidate !== "function") ||
      candidate === null
    ) {
      return;
    }
    const proxy =
      typeof candidate === "function" && "proxy" in candidate
        ? candidate.proxy
        : candidate;
    if (IsInterfaceProxy(proxy)) {
      const identity = GetInterfaceProxyIdentity(proxy);
      if (identity) {
        identities.add(identity);
      }
      return;
    }
    if (visited.has(candidate)) {
      return;
    }
    visited.add(candidate);
    Object.values(candidate).forEach(visit);
  };

  visit(value);
  return [...identities];
}

function loadInterfaceDeclaration(route: InterfaceProviderRoute): unknown {
  if (!route.packageEntry) {
    if (route.providerCount > 1) {
      throw new Error(
        `Cannot route '${route.interfaceName}' between ${route.providerCount} providers because its package could not be resolved. Configure one provider or install a resolvable interface package.`,
      );
    }
    return;
  }

  try {
    return require(route.packageEntry);
  } catch (error) {
    throw new Error(
      `Failed to prepare provider routing for '${route.interfaceName}' from '${route.packageEntry}'.`,
      { cause: error },
    );
  }
}

export function buildProviderRoutes(
  moduleId: string,
  routes: InterfaceProviderRoute[],
): Readonly<Record<string, string>> {
  const providerRoutes: Record<string, string> = {};
  for (const route of routes) {
    const declaration = loadInterfaceDeclaration(route);
    for (const identity of collectProxyIdentities(declaration)) {
      const current = providerRoutes[identity];
      if (current && current !== route.provider) {
        throw new Error(
          `Module '${moduleId}' resolves proxy '${identity}' to both '${current}' and '${route.provider}'. Use unique interface proxy identities.`,
        );
      }
      providerRoutes[identity] = route.provider;
    }
  }
  return providerRoutes;
}

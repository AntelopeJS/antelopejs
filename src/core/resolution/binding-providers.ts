import type { BindingModule } from "./binding-graph-types";

const DEFAULT_PRIORITY = 0;

function compareIds(left: string, right: string): number {
  return left.localeCompare(right);
}

/** The providers of each interface, and which of them is the default. */
export class ProviderTable {
  private readonly providers = new Map<string, string[]>();

  constructor(private readonly modules: ReadonlyMap<string, BindingModule>) {
    const sorted = [...modules].sort(([left], [right]) =>
      compareIds(left, right),
    );
    for (const [id, module] of sorted) {
      for (const interfaceName of module.implements) {
        if (module.disabledExports?.has(interfaceName)) {
          continue;
        }
        const providers = this.providers.get(interfaceName) ?? [];
        providers.push(id);
        this.providers.set(interfaceName, providers);
      }
    }
  }

  providersOf(interfaceName: string): readonly string[] {
    return this.providers.get(interfaceName) ?? [];
  }

  priorityOf(provider: string, interfaceName: string): number {
    return (
      this.modules.get(provider)?.exportPriority.get(interfaceName) ??
      DEFAULT_PRIORITY
    );
  }

  /** Providers with the highest priority for an interface, sorted by module ID. */
  defaultCandidates(interfaceName: string): readonly string[] {
    const providers = this.providersOf(interfaceName);
    if (providers.length === 0) {
      return providers;
    }
    const top = Math.max(
      ...providers.map((provider) => this.priorityOf(provider, interfaceName)),
    );
    return providers.filter(
      (provider) => this.priorityOf(provider, interfaceName) === top,
    );
  }

  defaultProvider(interfaceName: string): string | undefined {
    return this.defaultCandidates(interfaceName)[0];
  }

  /** Interfaces more than one module provides. */
  sharedInterfaces(): string[] {
    return [...this.providers]
      .filter(([, providers]) => providers.length > 1)
      .map(([interfaceName]) => interfaceName);
  }
}

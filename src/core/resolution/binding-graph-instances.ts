import type {
  BindingGraphInput,
  InstanceDescriptor,
} from "./binding-graph-types";
import type { ProviderTable } from "./binding-providers";

/** The interface instances a binding graph keys, by instance key. */
export class InstanceTable {
  private readonly instances = new Map<string, InstanceDescriptor>();

  constructor(
    private readonly input: BindingGraphInput,
    private readonly providers: ProviderTable,
  ) {}

  dependenciesOf(interfaceName: string): readonly string[] {
    return this.input.interfaces.get(interfaceName)?.dependencies ?? [];
  }

  /** Keys `provider`'s instance of `interfaceName`, private when it disables that export. */
  provided(interfaceName: string, provider: string): string {
    const key = `${interfaceName}@${provider}`;
    const isPrivate =
      this.input.modules.get(provider)?.disabledExports?.has(interfaceName) ??
      false;
    this.instances.set(key, {
      key,
      interfaceName,
      provider,
      dependencies: [],
      ...(isPrivate && { private: true }),
    });
    return key;
  }

  /** Keys the instance of `interfaceName` that imports the instances `dependencies` name. */
  selfHosted(interfaceName: string, dependencies: readonly string[]): string {
    const key = `${interfaceName}{${dependencies.join(",")}}`;
    this.instances.set(key, { key, interfaceName, dependencies });
    return key;
  }

  /**
   * The instances `bound` names, with the instances self-hosted ones import,
   * and an instance bound to the defaults of each interface whose named
   * instances are all private, so an import that declares no binding finds
   * the interface unprovided instead of reaching a disabled export. A cycle's
   * earlier rounds may have keyed others.
   */
  referenced(bound: readonly string[]): Map<string, InstanceDescriptor> {
    const named = this.closure(bound);
    const reachable = new Set<string>();
    const hidden = new Set<string>();
    for (const { interfaceName, private: isPrivate } of named.values()) {
      (isPrivate ? hidden : reachable).add(interfaceName);
    }
    const unbound = [...hidden]
      .filter((interfaceName) => !reachable.has(interfaceName))
      .map((interfaceName) => this.unbound(interfaceName));
    return unbound.length > 0 ? this.closure([...bound, ...unbound]) : named;
  }

  private unbound(interfaceName: string): string {
    const provider = this.providers.defaultProvider(interfaceName);
    if (provider) {
      return this.provided(interfaceName, provider);
    }
    return this.selfHosted(
      interfaceName,
      this.dependenciesOf(interfaceName).map((dependency) =>
        this.unbound(dependency),
      ),
    );
  }

  private closure(keys: readonly string[]): Map<string, InstanceDescriptor> {
    const pending = [...keys];
    const referenced = new Map<string, InstanceDescriptor>();
    while (pending.length > 0) {
      const key = pending.pop()!;
      const descriptor = this.instances.get(key);
      if (descriptor && !referenced.has(key)) {
        referenced.set(key, descriptor);
        pending.push(...descriptor.dependencies);
      }
    }
    return referenced;
  }
}

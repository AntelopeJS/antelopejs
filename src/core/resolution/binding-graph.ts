import {
  type CarriedBinding,
  describeDiamond,
  describeImplementedPin,
  describeRunningProviderGone,
  describeRunningRebind,
  describeUnsettledCycle,
} from "./binding-diagnostics";
import { ProviderTable } from "./binding-providers";
import { orderComponents } from "./binding-graph-order";
import {
  collectBindingWarnings,
  collectStartupDivergence,
} from "./binding-graph-warnings";
import type {
  BindingConnection,
  BindingGraph,
  BindingGraphInput,
  BindingModule,
  InstanceDescriptor,
  InterfaceBinding,
  ModuleBindings,
} from "./binding-graph-types";

const MAX_CYCLE_ROUNDS = 10;

type Scope = Map<string, InterfaceBinding>;
type Pins = ReadonlyMap<string, string>;

interface ResolutionTarget {
  scope: Scope;
  keys: Map<string, string>;
  overrides?: Pins;
  recordsEdges: boolean;
}

function compareIds(left: string, right: string): number {
  return left.localeCompare(right);
}

function carriedKey(carried: CarriedBinding): string {
  return [carried.value, carried.source ?? "", ...carried.path].join("\0");
}

class BindingGraphBuilder {
  private readonly moduleIds: string[];
  private readonly providers: ProviderTable;
  private readonly pins = new Map<string, Pins>();
  private readonly carried = new Map<string, Map<string, CarriedBinding[]>>();
  private readonly scopes = new Map<string, Scope>();
  private readonly keys = new Map<string, Map<string, string>>();
  private readonly edges = new Map<string, Set<string>>();
  private readonly instances = new Map<string, InstanceDescriptor>();
  private readonly moduleErrors = new Map<string, Set<string>>();
  private readonly errors = new Set<string>();

  constructor(private readonly input: BindingGraphInput) {
    this.moduleIds = [...input.modules.keys()].sort(compareIds);
    this.providers = new ProviderTable(input.modules);
    for (const id of this.moduleIds) {
      this.pins.set(id, this.readPins(input.modules.get(id)!));
    }
  }

  build(): BindingGraph {
    this.validatePins();
    const order = orderComponents(this.moduleIds, this.candidateEdges());
    for (const component of order) {
      this.settle(component);
    }
    this.moduleErrors.forEach((problems) =>
      problems.forEach((problem) => this.errors.add(problem)),
    );
    const warnings = collectBindingWarnings({
      moduleIds: this.moduleIds,
      scopes: this.scopes,
      edges: this.edges,
      pins: this.pins,
      providers: this.providers,
    });
    return {
      modules: this.collectModuleBindings(),
      instances: this.instances,
      edges: this.edges,
      errors: [...this.errors],
      warnings: [...new Set(warnings)],
    };
  }

  private readPins(module: BindingModule): Pins {
    const pins = new Map<string, string>();
    for (const [interfaceName, connections] of module.connections) {
      const selected = connections[0];
      if (selected?.source) {
        pins.set(interfaceName, selected.source);
      }
    }
    return pins;
  }

  private validatePins(): void {
    for (const id of this.moduleIds) {
      const module = this.input.modules.get(id)!;
      for (const [interfaceName, pinned] of this.pins.get(id)!) {
        if (module.implements.includes(interfaceName) && pinned !== id) {
          this.errors.add(describeImplementedPin(id, interfaceName, pinned));
        }
      }
    }
  }

  private dependenciesOf(interfaceName: string): readonly string[] {
    return this.input.interfaces.get(interfaceName)?.dependencies ?? [];
  }

  private importsOf(moduleId: string): string[] {
    const module = this.input.modules.get(moduleId)!;
    return [
      ...module.uses,
      ...module.implements.flatMap((name) => this.dependenciesOf(name)),
    ];
  }

  private closureOf(moduleId: string): Set<string> {
    const closure = new Set<string>();
    const pending = this.importsOf(moduleId);
    while (pending.length > 0) {
      const interfaceName = pending.pop()!;
      if (closure.has(interfaceName)) {
        continue;
      }
      closure.add(interfaceName);
      if (this.providers.providersOf(interfaceName).length === 0) {
        pending.push(...this.dependenciesOf(interfaceName));
      }
    }
    return closure;
  }

  private candidateEdges(): Map<string, Set<string>> {
    const candidates = new Map<string, Set<string>>();
    for (const id of this.moduleIds) {
      const reachable = [...this.closureOf(id)]
        .flatMap((interfaceName) => this.providers.providersOf(interfaceName))
        .filter((provider) => provider !== id);
      candidates.set(id, new Set(reachable));
    }
    return candidates;
  }

  private settle(component: readonly string[]): void {
    for (let round = 0; round < MAX_CYCLE_ROUNDS; round += 1) {
      const before = this.snapshot(component);
      component.forEach((id) => this.resolveModule(id));
      component.forEach((id) => this.pushDown(id));
      if (this.snapshot(component) === before) {
        return;
      }
    }
    this.errors.add(describeUnsettledCycle(component));
  }

  private snapshot(component: readonly string[]): string {
    return JSON.stringify(
      component.map((id) => [
        [...(this.scopes.get(id) ?? [])],
        [...(this.carried.get(id) ?? [])],
      ]),
    );
  }

  private resolveModule(moduleId: string): void {
    const module = this.input.modules.get(moduleId)!;
    const target: ResolutionTarget = {
      scope: new Map(),
      keys: new Map(),
      recordsEdges: true,
    };
    this.edges.set(moduleId, new Set());
    this.moduleErrors.delete(moduleId);
    for (const interfaceName of [
      ...this.importsOf(moduleId),
      ...module.implements,
    ]) {
      this.keyOf(moduleId, interfaceName, target);
    }
    this.scopes.set(moduleId, target.scope);
    this.keys.set(moduleId, target.keys);
  }

  private keyOf(
    moduleId: string,
    interfaceName: string,
    target: ResolutionTarget,
  ): string {
    const existing = target.keys.get(interfaceName);
    if (existing) {
      return existing;
    }
    const binding =
      target.scope.get(interfaceName) ??
      this.bind(moduleId, interfaceName, target.overrides);
    target.scope.set(interfaceName, binding);
    const key = binding.provider
      ? this.providedInstance(moduleId, interfaceName, binding.provider, target)
      : this.selfHostedInstance(moduleId, interfaceName, target);
    target.keys.set(interfaceName, key);
    return key;
  }

  private providedInstance(
    moduleId: string,
    interfaceName: string,
    provider: string,
    target: ResolutionTarget,
  ): string {
    if (target.recordsEdges && provider !== moduleId) {
      this.edges.get(moduleId)!.add(provider);
    }
    const key = `${interfaceName}@${provider}`;
    this.instances.set(key, { key, interfaceName, provider, dependencies: [] });
    return key;
  }

  private selfHostedInstance(
    moduleId: string,
    interfaceName: string,
    target: ResolutionTarget,
  ): string {
    const dependencies = this.dependenciesOf(interfaceName).map((dependency) =>
      this.keyOf(moduleId, dependency, target),
    );
    const key = `${interfaceName}{${dependencies.join(",")}}`;
    this.instances.set(key, { key, interfaceName, dependencies });
    return key;
  }

  private bind(
    moduleId: string,
    interfaceName: string,
    overrides?: Pins,
  ): InterfaceBinding {
    const module = this.input.modules.get(moduleId)!;
    if (module.implements.includes(interfaceName)) {
      return { provider: moduleId, reason: "implements" };
    }
    const pinned =
      overrides?.get(interfaceName) ??
      this.pins.get(moduleId)!.get(interfaceName);
    if (pinned) {
      return { provider: pinned, reason: "pin" };
    }
    const running = this.input.running?.get(moduleId)?.get(interfaceName);
    if (running !== undefined) {
      this.checkRunning(moduleId, interfaceName, running);
      return { provider: running, reason: "running" };
    }
    return this.bindCarried(moduleId, interfaceName);
  }

  private bindCarried(
    moduleId: string,
    interfaceName: string,
  ): InterfaceBinding {
    const carried = this.carried.get(moduleId)?.get(interfaceName) ?? [];
    if (carried.length === 0) {
      return this.bindDefault(interfaceName);
    }
    if (new Set(carried.map(({ value }) => value)).size > 1) {
      this.reportDiamond(moduleId, interfaceName, carried);
    }
    const chosen = carried.find(({ source }) => source) ?? carried[0];
    return chosen.source
      ? { provider: chosen.value, reason: "carried", source: chosen.source }
      : { provider: chosen.value, reason: "default" };
  }

  private bindDefault(interfaceName: string): InterfaceBinding {
    const provider = this.providers.defaultProvider(interfaceName);
    return provider
      ? { provider, reason: "default" }
      : { reason: "self-hosted" };
  }

  private addModuleError(moduleId: string, problem: string): void {
    const problems = this.moduleErrors.get(moduleId) ?? new Set<string>();
    problems.add(problem);
    this.moduleErrors.set(moduleId, problems);
  }

  private checkRunning(
    moduleId: string,
    interfaceName: string,
    running: string,
  ): void {
    if (!this.providers.providersOf(interfaceName).includes(running)) {
      this.addModuleError(
        moduleId,
        describeRunningProviderGone(moduleId, interfaceName, running),
      );
    }
    const carried = this.carried.get(moduleId)?.get(interfaceName) ?? [];
    const conflicting = carried.find(({ value }) => value !== running);
    if (conflicting) {
      this.addModuleError(
        moduleId,
        describeRunningRebind(moduleId, interfaceName, running, conflicting),
      );
    }
  }

  private reportDiamond(
    moduleId: string,
    interfaceName: string,
    carried: readonly CarriedBinding[],
  ): void {
    const first = carried[0];
    const second = carried.find(({ value }) => value !== first.value)!;
    const firstPath = [...first.path, moduleId];
    const secondPath = [...second.path, moduleId];
    const merge =
      firstPath.find(
        (node, index) =>
          index > 0 &&
          secondPath.includes(node) &&
          node !== firstPath[0] &&
          node !== secondPath[0],
      ) ?? moduleId;
    const upToMerge = (path: string[]) =>
      path.slice(0, path.indexOf(merge) + 1);
    this.addModuleError(
      moduleId,
      describeDiamond(
        merge,
        interfaceName,
        { carried: first, path: upToMerge(firstPath) },
        { carried: second, path: upToMerge(secondPath) },
      ),
    );
  }

  private outgoingBindings(moduleId: string): Map<string, CarriedBinding[]> {
    const module = this.input.modules.get(moduleId)!;
    const running = this.input.running?.get(moduleId);
    const outgoing = new Map<string, CarriedBinding[]>();
    const setOwn = (interfaceName: string, value: string) =>
      outgoing.set(interfaceName, [
        { value, source: moduleId, path: [moduleId] },
      ]);
    this.pins.get(moduleId)!.forEach((value, name) => setOwn(name, value));
    running?.forEach((value, name) => {
      if (!outgoing.has(name) && !module.implements.includes(name)) {
        setOwn(name, value);
      }
    });
    this.carried.get(moduleId)?.forEach((list, name) => {
      if (!outgoing.has(name)) {
        outgoing.set(
          name,
          list.map((carried) => ({
            ...carried,
            path: [...carried.path, moduleId],
          })),
        );
      }
    });
    if (!running) {
      this.addDefaults(moduleId, outgoing);
    }
    return outgoing;
  }

  private addDefaults(
    moduleId: string,
    outgoing: Map<string, CarriedBinding[]>,
  ): void {
    for (const interfaceName of this.providers.sharedInterfaces()) {
      if (!outgoing.has(interfaceName)) {
        outgoing.set(interfaceName, [
          {
            value: this.providers.defaultProvider(interfaceName)!,
            path: [moduleId],
          },
        ]);
      }
    }
  }

  private pushDown(moduleId: string): void {
    const outgoing = this.outgoingBindings(moduleId);
    for (const provider of this.edges.get(moduleId) ?? []) {
      for (const [interfaceName, list] of outgoing) {
        list
          .filter(({ path }) => !path.includes(provider))
          .forEach((carried) => this.receive(provider, interfaceName, carried));
      }
    }
  }

  private receive(
    moduleId: string,
    interfaceName: string,
    carried: CarriedBinding,
  ): void {
    const received = this.carried.get(moduleId) ?? new Map();
    const list: CarriedBinding[] = received.get(interfaceName) ?? [];
    if (
      !list.some((existing) => carriedKey(existing) === carriedKey(carried))
    ) {
      list.push(carried);
    }
    received.set(interfaceName, list);
    this.carried.set(moduleId, received);
  }

  private connectionKeys(moduleId: string): Map<string, string[]> {
    const module = this.input.modules.get(moduleId)!;
    const keys = new Map<string, string[]>();
    const listed = module.listedConnections ?? module.connections;
    for (const [interfaceName, connections] of listed) {
      keys.set(
        interfaceName,
        connections.map((connection) =>
          this.connectionKey(moduleId, interfaceName, connection),
        ),
      );
    }
    return keys;
  }

  private connectionScope(
    moduleId: string,
    interfaceName: string,
    connection: BindingConnection,
  ): Map<string, string> {
    const module = this.input.modules.get(moduleId)!;
    const overrides = new Map<string, string>();
    if (connection.id === undefined) {
      if (connection.source) {
        overrides.set(interfaceName, connection.source);
      }
      return overrides;
    }
    for (const [name, entries] of module.connections) {
      const entry = entries.find(({ id }) => id === connection.id);
      if (entry?.source) {
        overrides.set(name, entry.source);
      }
    }
    return overrides;
  }

  private connectionKey(
    moduleId: string,
    interfaceName: string,
    connection: BindingConnection,
  ): string {
    return this.keyOf(moduleId, interfaceName, {
      scope: new Map(),
      keys: new Map(),
      overrides: this.connectionScope(moduleId, interfaceName, connection),
      recordsEdges: false,
    });
  }

  private collectModuleBindings(): Map<string, ModuleBindings> {
    const modules = new Map<string, ModuleBindings>();
    for (const id of this.moduleIds) {
      modules.set(id, {
        scope: this.scopes.get(id) ?? new Map(),
        keys: this.keys.get(id) ?? new Map(),
        connectionKeys: this.connectionKeys(id),
      });
    }
    return modules;
  }
}

/**
 * Binds every module's interfaces to providers and derives the interface
 * instances the project needs.
 *
 * A module binds an interface, nearest first, to itself when it implements
 * it, to its own pin, to the pin carried from its nearest pinned ancestor,
 * or to the default: the provider with the highest export priority, sorted
 * first on a tie. Pins are carried down from consumers to the modules that
 * provide what they use; an unpinned path carries the default. A module
 * reached through two paths carrying different bindings is an error.
 * Instances with equal keys are one instance.
 */
export function buildBindingGraph(input: BindingGraphInput): BindingGraph {
  const graph = new BindingGraphBuilder(input).build();
  if (!input.running || input.running.size === 0) {
    return graph;
  }
  const fresh = buildBindingGraph({ ...input, running: undefined });
  return {
    ...graph,
    warnings: [
      ...graph.warnings,
      ...collectStartupDivergence(input.running, fresh),
    ],
  };
}

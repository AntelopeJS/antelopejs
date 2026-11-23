import {
  type CarriedBinding,
  describeDiamondAt,
  describeImplementedPin,
  describePinWithoutProvider,
  describeRunningProviderGone,
  describeRunningRebind,
  describeUnprovidedCycle,
  describeUnsettledCycle,
} from "./binding-diagnostics";
import { connectionOverrides } from "./binding-connections";
import { InstanceTable } from "./binding-graph-instances";
import { orderComponents } from "./binding-graph-order";
import type {
  BindingConnection,
  BindingGraph,
  BindingGraphInput,
  BindingModule,
  InterfaceBinding,
  ModuleBindings,
} from "./binding-graph-types";
import {
  collectBindingWarnings,
  collectStartupDivergence,
} from "./binding-graph-warnings";
import { ProviderTable } from "./binding-providers";

const MAX_CYCLE_ROUNDS = 10;

type Scope = Map<string, InterfaceBinding>;
type Pins = ReadonlyMap<string, string>;

interface ModuleNode {
  id: string;
  module: BindingModule;
  pins: Pins;
}

interface ResolutionTarget {
  node: ModuleNode;
  scope: Scope;
  keys: Map<string, string>;
  /** Interfaces being keyed, outermost first. */
  keying: Set<string>;
  overrides?: Pins;
  /** Where a provider the module binds is recorded; absent when none is. */
  edges?: Set<string>;
  /** Records a problem met while keying, where the graph's errors read it. */
  report: (problem: string) => void;
}

function compareIds(left: string, right: string): number {
  return left.localeCompare(right);
}

function carriedKey(carried: CarriedBinding): string {
  return [carried.value, carried.source ?? "", ...carried.path].join("\0");
}

class BindingGraphBuilder {
  private readonly nodes: ModuleNode[];
  private readonly nodeById = new Map<string, ModuleNode>();
  private readonly moduleIds: string[];
  private readonly providers: ProviderTable;
  private readonly pins = new Map<string, Pins>();
  private readonly carried = new Map<string, Map<string, CarriedBinding[]>>();
  private readonly scopes = new Map<string, Scope>();
  private readonly keys = new Map<string, Map<string, string>>();
  private readonly edges = new Map<string, Set<string>>();
  private readonly instances: InstanceTable;
  private readonly moduleErrors = new Map<string, Set<string>>();
  private readonly errors = new Set<string>();

  constructor(private readonly input: BindingGraphInput) {
    this.nodes = [...input.modules]
      .sort(([left], [right]) => compareIds(left, right))
      .map(([id, module]) => ({ id, module, pins: this.readPins(module) }));
    this.moduleIds = this.nodes.map(({ id }) => id);
    this.providers = new ProviderTable(input.modules);
    this.instances = new InstanceTable(input, this.providers);
    for (const node of this.nodes) {
      this.pins.set(node.id, node.pins);
      this.nodeById.set(node.id, node);
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
    const modules = this.collectModuleBindings();
    const bound = [...modules.values()].flatMap((bindings) => [
      ...bindings.keys.values(),
      ...[...bindings.connectionKeys.values()].flat(),
    ]);
    return {
      modules,
      instances: this.instances.referenced(bound),
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
    for (const { id, module, pins } of this.nodes) {
      for (const [interfaceName, pinned] of pins) {
        if (module.implements.includes(interfaceName) && pinned !== id) {
          this.errors.add(describeImplementedPin(id, interfaceName, pinned));
        }
      }
    }
  }

  private dependenciesOf(interfaceName: string): readonly string[] {
    return this.instances.dependenciesOf(interfaceName);
  }

  private importsOf(module: BindingModule): string[] {
    return [
      ...module.uses,
      ...module.implements.flatMap((name) => this.dependenciesOf(name)),
    ];
  }

  private closureOf(module: BindingModule): Set<string> {
    const closure = new Set<string>();
    const pending = this.importsOf(module);
    for (
      let interfaceName = pending.pop();
      interfaceName !== undefined;
      interfaceName = pending.pop()
    ) {
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
    for (const { id, module } of this.nodes) {
      const reachable = [...this.closureOf(module)]
        .flatMap((interfaceName) => this.providers.providersOf(interfaceName))
        .filter((provider) => provider !== id);
      candidates.set(id, new Set(reachable));
    }
    return candidates;
  }

  private settle(component: readonly string[]): void {
    for (let round = 0; round < MAX_CYCLE_ROUNDS; round += 1) {
      const before = this.snapshot(component);
      const nodes = this.nodesOf(component);
      nodes.forEach((node) => this.resolveModule(node));
      nodes.forEach((node) => this.pushDown(node));
      if (this.snapshot(component) === before) {
        return;
      }
    }
    this.errors.add(describeUnsettledCycle(component));
  }

  private nodesOf(component: readonly string[]): ModuleNode[] {
    const nodes: ModuleNode[] = [];
    for (const id of component) {
      const node = this.nodeById.get(id);
      if (node) {
        nodes.push(node);
      }
    }
    return nodes;
  }

  private snapshot(component: readonly string[]): string {
    return JSON.stringify(
      component.map((id) => [
        [...(this.scopes.get(id) ?? [])],
        [...(this.carried.get(id) ?? [])],
      ]),
    );
  }

  private resolveModule(node: ModuleNode): void {
    const { id: moduleId, module } = node;
    const edges = new Set<string>();
    const target: ResolutionTarget = {
      node,
      scope: new Map(),
      keys: new Map(),
      keying: new Set(),
      edges,
      report: (problem) => this.addModuleError(moduleId, problem),
    };
    this.edges.set(moduleId, edges);
    this.moduleErrors.delete(moduleId);
    for (const interfaceName of [
      ...this.importsOf(module),
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
    if (target.keying.has(interfaceName)) {
      return this.unprovidedCycle(moduleId, interfaceName, target);
    }
    target.keying.add(interfaceName);
    const binding =
      target.scope.get(interfaceName) ??
      this.bind(moduleId, interfaceName, target);
    target.scope.set(interfaceName, binding);
    const key = binding.provider
      ? this.providedInstance(moduleId, interfaceName, binding.provider, target)
      : this.selfHostedInstance(moduleId, interfaceName, target);
    target.keying.delete(interfaceName);
    target.keys.set(interfaceName, key);
    return key;
  }

  /**
   * Reports an interface reached again while its own self-hosted instance is
   * being keyed, and returns a key no instance has, since such an instance
   * would import itself.
   */
  private unprovidedCycle(
    moduleId: string,
    interfaceName: string,
    target: ResolutionTarget,
  ): string {
    const keying = [...target.keying];
    const cycle = [
      ...keying.slice(keying.indexOf(interfaceName)),
      interfaceName,
    ];
    target.report(describeUnprovidedCycle(moduleId, keying[0], cycle));
    return `${interfaceName}{cycle}`;
  }

  private providedInstance(
    moduleId: string,
    interfaceName: string,
    provider: string,
    target: ResolutionTarget,
  ): string {
    if (provider !== moduleId) {
      target.edges?.add(provider);
    }
    return this.instances.provided(interfaceName, provider);
  }

  private selfHostedInstance(
    moduleId: string,
    interfaceName: string,
    target: ResolutionTarget,
  ): string {
    const dependencies = this.dependenciesOf(interfaceName).map((dependency) =>
      this.keyOf(moduleId, dependency, target),
    );
    return this.instances.selfHosted(interfaceName, dependencies);
  }

  private bind(
    moduleId: string,
    interfaceName: string,
    target: ResolutionTarget,
  ): InterfaceBinding {
    const { module, pins } = target.node;
    const override = target.overrides?.get(interfaceName);
    if (override === undefined && module.implements.includes(interfaceName)) {
      return { provider: moduleId, reason: "implements" };
    }
    const pinned = override ?? pins.get(interfaceName);
    if (pinned) {
      if (!this.providers.providersOf(interfaceName).includes(pinned)) {
        this.addModuleError(
          moduleId,
          describePinWithoutProvider(moduleId, interfaceName, pinned),
        );
      }
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
    const first = carried[0];
    const second = carried.find(({ value }) => value !== first.value);
    if (second) {
      this.addModuleError(
        moduleId,
        describeDiamondAt(moduleId, interfaceName, first, second),
      );
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

  private outgoingBindings({
    id: moduleId,
    module,
    pins,
  }: ModuleNode): Map<string, CarriedBinding[]> {
    const running = this.input.running?.get(moduleId);
    const outgoing = new Map<string, CarriedBinding[]>();
    const setOwn = (interfaceName: string, value: string) =>
      outgoing.set(interfaceName, [
        { value, source: moduleId, path: [moduleId] },
      ]);
    pins.forEach((value, name) => setOwn(name, value));
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
    for (const [interfaceName, value] of this.providers.sharedDefaults()) {
      if (!outgoing.has(interfaceName)) {
        outgoing.set(interfaceName, [{ value, path: [moduleId] }]);
      }
    }
  }

  private pushDown(node: ModuleNode): void {
    const outgoing = this.outgoingBindings(node);
    for (const provider of this.edges.get(node.id) ?? []) {
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
    const received =
      this.carried.get(moduleId) ?? new Map<string, CarriedBinding[]>();
    const list = received.get(interfaceName) ?? [];
    if (
      !list.some((existing) => carriedKey(existing) === carriedKey(carried))
    ) {
      list.push(carried);
    }
    received.set(interfaceName, list);
    this.carried.set(moduleId, received);
  }

  private connectionKeys(node: ModuleNode): Map<string, string[]> {
    const { module } = node;
    const keys = new Map<string, string[]>();
    const listed = module.listedConnections ?? module.connections;
    for (const [interfaceName, connections] of listed) {
      keys.set(
        interfaceName,
        connections.map((connection) =>
          this.connectionKey(node, interfaceName, connection),
        ),
      );
    }
    return keys;
  }

  private connectionKey(
    node: ModuleNode,
    interfaceName: string,
    connection: BindingConnection,
  ): string {
    return this.keyOf(node.id, interfaceName, {
      node,
      scope: new Map(),
      keys: new Map(),
      keying: new Set(),
      overrides: connectionOverrides(node.module, interfaceName, connection),
      report: (problem) => this.errors.add(problem),
    });
  }

  private collectModuleBindings(): Map<string, ModuleBindings> {
    const modules = new Map<string, ModuleBindings>();
    for (const node of this.nodes) {
      const { id } = node;
      modules.set(id, {
        scope: this.scopes.get(id) ?? new Map(),
        keys: this.keys.get(id) ?? new Map(),
        connectionKeys: this.connectionKeys(node),
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

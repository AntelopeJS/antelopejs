const INTERFACE_BINDING_ERROR_NAME = "InterfaceBindingError";
const INTERFACE_BINDING_HEADLINE = "Inconsistent interface bindings:";
const PATH_SEPARATOR = " -> ";

/** A binding that reached a module along one path of the module graph. */
export interface CarriedBinding {
  value: string;
  /** The pinning module, or undefined for the default carried by an unpinned path. */
  source?: string;
  /** Modules the binding went through, from where it was set to the receiving module. */
  path: readonly string[];
}

/** One of the two paths that meet at a diamond, cut at the module where they meet. */
export interface DiamondSide {
  carried: CarriedBinding;
  path: readonly string[];
}

function describeSide({ carried, path }: DiamondSide): string {
  const how = carried.source ? "pins" : "uses the default";
  return `${path.join(PATH_SEPARATOR)} ${how} '${carried.value}'`;
}

/** A module reached through two paths carrying different bindings for one interface. */
export function describeDiamond(
  merge: string,
  interfaceName: string,
  first: DiamondSide,
  second: DiamondSide,
): string {
  return `${merge} is reached with two bindings for ${interfaceName}: ${describeSide(first)}, ${describeSide(second)}. Pin ${interfaceName} on ${merge} to choose.`;
}

/** A module loaded at runtime would change the binding of a running one. */
export function describeRunningRebind(
  moduleId: string,
  interfaceName: string,
  running: string,
  carried: CarriedBinding,
): string {
  const how = carried.source ? "a pin of" : "the default";
  return `Loading would re-bind running module ${moduleId}: ${[...carried.path, moduleId].join(PATH_SEPARATOR)} carries ${how} '${carried.value}' for ${interfaceName}, and ${moduleId} runs on '${running}'.`;
}

export function describeImplementedPin(
  moduleId: string,
  interfaceName: string,
  pinned: string,
): string {
  return `Module '${moduleId}' implements ${interfaceName} but pins it to '${pinned}'.`;
}

export function describeUnsettledCycle(modules: readonly string[]): string {
  return `Interface bindings do not settle in the module cycle ${modules.join(", ")}.`;
}

/** A module that resolved an interface by default among several providers. */
export interface AmbiguousDefault {
  moduleId: string;
  interfaceName: string;
  chosen: string;
  providers: readonly string[];
  priorities: ReadonlyMap<string, number>;
  /** Top-level modules above the module, where one pin covers it. */
  pinTargets: readonly string[];
}

export function describeAmbiguousDefault(ambiguity: AmbiguousDefault): string {
  const { moduleId, interfaceName, chosen, priorities } = ambiguity;
  const listed = ambiguity.providers.map((provider) => {
    const priority = priorities.get(provider) ?? 0;
    return priority === 0 ? provider : `${provider} [${priority}]`;
  });
  return `${moduleId} resolves ${interfaceName} to '${chosen}' by default (providers: ${listed.join(", ")}). Pin ${interfaceName} on ${ambiguity.pinTargets.join(" or ")}.`;
}

export function describeUnusedPin(
  moduleId: string,
  interfaceName: string,
): string {
  return `Module '${moduleId}' pins ${interfaceName}, but that pin decides no binding.`;
}

export function describeStartupDivergence(
  moduleId: string,
  interfaceName: string,
  running: string,
  fresh: string,
): string {
  return `${moduleId} keeps ${interfaceName} on '${running}' while running; the next startup binds it to '${fresh}'.`;
}

/**
 * Thrown when the configured pins cannot bind every module consistently: a
 * module reached through two paths that carry different bindings, a module
 * pinning an interface it implements, a cycle whose bindings never settle, or
 * a module loaded at runtime that would re-bind a running one.
 */
export class InterfaceBindingError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      [
        INTERFACE_BINDING_HEADLINE,
        ...problems.map((problem) => `  - ${problem}`),
      ].join("\n"),
    );
    this.name = INTERFACE_BINDING_ERROR_NAME;
  }
}

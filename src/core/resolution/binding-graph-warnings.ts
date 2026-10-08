import {
  describeAmbiguousDefault,
  describeStartupDivergence,
  describeUnusedPin,
} from "./binding-diagnostics";
import type { ProviderTable } from "./binding-providers";
import type { BindingGraph, InterfaceBinding } from "./binding-graph-types";

/** What the warnings read from a finished resolution. */
export interface BindingWarningView {
  moduleIds: readonly string[];
  scopes: ReadonlyMap<string, ReadonlyMap<string, InterfaceBinding>>;
  edges: ReadonlyMap<string, ReadonlySet<string>>;
  pins: ReadonlyMap<string, ReadonlyMap<string, string>>;
  providers: ProviderTable;
}

function pinTargets(view: BindingWarningView, moduleId: string): string[] {
  const roots = new Set<string>();
  const seen = new Set<string>();
  const climb = (id: string) => {
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    const parents = view.moduleIds.filter((parent) =>
      view.edges.get(parent)?.has(id),
    );
    if (parents.length === 0) {
      roots.add(id);
    }
    parents.forEach(climb);
  };
  climb(moduleId);
  return [...roots].sort();
}

function isAmbiguous(
  view: BindingWarningView,
  interfaceName: string,
  binding: InterfaceBinding,
): boolean {
  return (
    binding.reason === "default" &&
    view.providers.providersOf(interfaceName).length > 1 &&
    view.providers.defaultCandidates(interfaceName).length > 1
  );
}

function ambiguityWarning(
  view: BindingWarningView,
  moduleId: string,
  interfaceName: string,
): string {
  const providers = view.providers.providersOf(interfaceName);
  return describeAmbiguousDefault({
    moduleId,
    interfaceName,
    chosen: view.providers.defaultProvider(interfaceName)!,
    providers,
    priorities: new Map(
      providers.map((provider) => [
        provider,
        view.providers.priorityOf(provider, interfaceName),
      ]),
    ),
    pinTargets: pinTargets(view, moduleId),
  });
}

function ambiguityWarnings(view: BindingWarningView): string[] {
  return [...view.scopes].flatMap(([moduleId, scope]) =>
    [...scope]
      .filter(([interfaceName, binding]) =>
        isAmbiguous(view, interfaceName, binding),
      )
      .map(([interfaceName]) =>
        ambiguityWarning(view, moduleId, interfaceName),
      ),
  );
}

function hasEffect(
  view: BindingWarningView,
  source: string,
  interfaceName: string,
): boolean {
  return [...view.scopes].some(([moduleId, scope]) => {
    const binding = scope.get(interfaceName);
    return moduleId === source
      ? binding?.reason === "pin"
      : binding?.reason === "carried" && binding.source === source;
  });
}

function unusedPinWarnings(view: BindingWarningView): string[] {
  return view.moduleIds.flatMap((id) =>
    [...(view.pins.get(id)?.keys() ?? [])]
      .filter((interfaceName) => !hasEffect(view, id, interfaceName))
      .map((interfaceName) => describeUnusedPin(id, interfaceName)),
  );
}

/** Ambiguous defaults, and pins that decide no binding. */
export function collectBindingWarnings(view: BindingWarningView): string[] {
  return [...ambiguityWarnings(view), ...unusedPinWarnings(view)];
}

/** Running bindings a fresh startup would bind differently. */
export function collectStartupDivergence(
  running: ReadonlyMap<string, ReadonlyMap<string, string>>,
  fresh: BindingGraph,
): string[] {
  return [...running].flatMap(([moduleId, bindings]) =>
    [...bindings].flatMap(([interfaceName, provider]) => {
      const next = fresh.modules.get(moduleId)?.scope.get(interfaceName);
      return next?.provider && next.provider !== provider
        ? [
            describeStartupDivergence(
              moduleId,
              interfaceName,
              provider,
              next.provider,
            ),
          ]
        : [];
    }),
  );
}

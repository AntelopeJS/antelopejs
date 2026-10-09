type Successors = ReadonlyMap<string, ReadonlySet<string>>;

interface TarjanState {
  index: number;
  indices: Map<string, number>;
  lowLinks: Map<string, number>;
  stack: string[];
  onStack: Set<string>;
  components: string[][];
}

function visit(node: string, successors: Successors, state: TarjanState) {
  state.indices.set(node, state.index);
  state.lowLinks.set(node, state.index);
  state.index += 1;
  state.stack.push(node);
  state.onStack.add(node);
  for (const next of successors.get(node) ?? []) {
    if (!state.indices.has(next)) {
      visit(next, successors, state);
      state.lowLinks.set(
        node,
        Math.min(state.lowLinks.get(node)!, state.lowLinks.get(next)!),
      );
    } else if (state.onStack.has(next)) {
      state.lowLinks.set(
        node,
        Math.min(state.lowLinks.get(node)!, state.indices.get(next)!),
      );
    }
  }
  if (state.lowLinks.get(node) === state.indices.get(node)) {
    state.components.push(popComponent(node, state));
  }
}

function popComponent(root: string, state: TarjanState): string[] {
  const component: string[] = [];
  let member: string | undefined;
  do {
    member = state.stack.pop()!;
    state.onStack.delete(member);
    component.push(member);
  } while (member !== root);
  return component.sort();
}

/**
 * Strongly connected components of a directed graph, ordered so that every
 * component comes before the components it points to.
 */
export function orderComponents(
  nodes: readonly string[],
  successors: Successors,
): string[][] {
  const state: TarjanState = {
    index: 0,
    indices: new Map(),
    lowLinks: new Map(),
    stack: [],
    onStack: new Set(),
    components: [],
  };
  for (const node of nodes) {
    if (!state.indices.has(node)) {
      visit(node, successors, state);
    }
  }
  return state.components.reverse();
}

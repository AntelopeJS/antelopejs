type Successors = ReadonlyMap<string, ReadonlySet<string>>;

interface Vertex {
  index: number;
  lowLink: number;
}

interface TarjanState {
  index: number;
  vertices: Map<string, Vertex>;
  stack: string[];
  onStack: Set<string>;
  components: string[][];
}

function visit(
  node: string,
  successors: Successors,
  state: TarjanState,
): Vertex {
  const vertex = { index: state.index, lowLink: state.index };
  state.vertices.set(node, vertex);
  state.index += 1;
  state.stack.push(node);
  state.onStack.add(node);
  for (const next of successors.get(node) ?? []) {
    const seen = state.vertices.get(next);
    if (!seen) {
      const child = visit(next, successors, state);
      vertex.lowLink = Math.min(vertex.lowLink, child.lowLink);
    } else if (state.onStack.has(next)) {
      vertex.lowLink = Math.min(vertex.lowLink, seen.index);
    }
  }
  if (vertex.lowLink === vertex.index) {
    state.components.push(popComponent(node, state));
  }
  return vertex;
}

function popComponent(root: string, state: TarjanState): string[] {
  const component = state.stack.splice(state.stack.lastIndexOf(root));
  component.forEach((member) => state.onStack.delete(member));
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
    vertices: new Map(),
    stack: [],
    onStack: new Set(),
    components: [],
  };
  for (const node of nodes) {
    if (!state.vertices.has(node)) {
      visit(node, successors, state);
    }
  }
  return state.components.reverse();
}

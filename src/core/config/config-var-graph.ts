import { type ConfigVarReference, scanConfigVars } from "./config-vars";

export interface ConfigVarModule {
  id: string;
  declared: string[];
  config: unknown;
}

export interface ConfigVarPlan {
  stages: string[][];
  dependencies: Map<string, Set<string>>;
}

type ConfigVarDeclarations = Map<string, Set<string>>;

const REFERENCE_SHAPE = "${@<module>.<VAR_NAME>}";

/**
 * The staged construction order the config variable graph imposes.
 *
 * Every reference is checked against the declarations before the first stage
 * is returned, so an unknown provider, an undeclared variable or a cycle is
 * reported before a single module constructs. Modules that share no variable
 * land in the same stage and construct concurrently.
 */
export function buildConfigVarPlan(modules: ConfigVarModule[]): ConfigVarPlan {
  const declarations: ConfigVarDeclarations = new Map(
    modules.map((module) => [module.id, new Set(module.declared)]),
  );
  const dependencies = new Map<string, Set<string>>();

  for (const module of modules) {
    const scan = scanConfigVars(module.config);
    assertWellFormed(module.id, scan.malformed);
    dependencies.set(
      module.id,
      collectProviders(module.id, scan.references, declarations),
    );
  }

  const stages = buildStages(
    modules.map((module) => module.id),
    dependencies,
  );
  return { stages, dependencies };
}

function assertWellFormed(consumerId: string, malformed: string[]): void {
  const token = malformed[0];
  if (!token) {
    return;
  }
  throw new Error(
    `Module '${consumerId}' references '${token}', which is not a valid config variable reference (expected '${REFERENCE_SHAPE}').`,
  );
}

function collectProviders(
  consumerId: string,
  references: ConfigVarReference[],
  declarations: ConfigVarDeclarations,
): Set<string> {
  const providers = new Set<string>();
  for (const reference of references) {
    assertProvides(consumerId, reference, declarations);
    providers.add(reference.module);
  }
  return providers;
}

function assertProvides(
  consumerId: string,
  reference: ConfigVarReference,
  declarations: ConfigVarDeclarations,
): void {
  const declared = declarations.get(reference.module);
  if (!declared) {
    throw new Error(
      `Module '${consumerId}' references '${reference.token}', but its expected provider '${reference.module}' is not a loaded module.`,
    );
  }
  if (!declared.has(reference.variable)) {
    throw new Error(
      `Module '${consumerId}' references '${reference.token}', but its expected provider '${reference.module}' does not declare the config variable '${reference.variable}' in antelopeJs.configVars.`,
    );
  }
}

function buildStages(
  ids: string[],
  dependencies: Map<string, Set<string>>,
): string[][] {
  const remaining = new Set(ids);
  const stages: string[][] = [];

  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) =>
      [...(dependencies.get(id) ?? [])].every(
        (provider) => !remaining.has(provider),
      ),
    );
    if (ready.length === 0) {
      throw new Error(
        `Config variable cycle detected: ${findCycle(remaining, dependencies).join(" -> ")}`,
      );
    }
    ready.forEach((id) => remaining.delete(id));
    stages.push(ready);
  }

  return stages;
}

function findCycle(
  nodes: Set<string>,
  dependencies: Map<string, Set<string>>,
): string[] {
  const path: string[] = [];
  const onPath = new Set<string>();
  const visited = new Set<string>();

  const walk = (id: string): string[] | undefined => {
    if (onPath.has(id)) {
      return [...path.slice(path.indexOf(id)), id];
    }
    if (visited.has(id)) {
      return undefined;
    }
    visited.add(id);
    onPath.add(id);
    path.push(id);
    for (const provider of dependencies.get(id) ?? []) {
      const cycle = nodes.has(provider) ? walk(provider) : undefined;
      if (cycle) {
        return cycle;
      }
    }
    path.pop();
    onPath.delete(id);
    return undefined;
  };

  for (const id of nodes) {
    const cycle = walk(id);
    if (cycle) {
      return cycle;
    }
  }
  return [];
}

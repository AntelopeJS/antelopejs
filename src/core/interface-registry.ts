import { internal } from '../interfaces/core/beta';

export interface InterfaceConnectionRef {
  module: string;
  id?: string;
}

export class InterfaceRegistry {
  setConnections(moduleId: string, connections: Map<string, InterfaceConnectionRef[]>): void {
    const connectionIDs: Record<string, Array<{ id?: string; path: string }>> = {};
    for (const [interfaceName, modules] of connections) {
      connectionIDs[interfaceName] = modules.map(({ id, module }) => {
        const entry: { path: string; id?: string } = { path: `@ajs.raw/${module}/${interfaceName}` };
        if (id !== undefined) {
          entry.id = id;
        }
        return entry;
      });
    }
    internal.interfaceConnections[moduleId] = connectionIDs;
  }

  getConnections(moduleId: string, interfaceId: string): Array<{ id?: string; path: string }> {
    return internal.interfaceConnections[moduleId]?.[interfaceId] ?? [];
  }

  clearModule(moduleId: string): void {
    delete internal.interfaceConnections[moduleId];
  }
}

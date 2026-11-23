import type { BindingConnection, BindingModule } from "./binding-graph-types";

/**
 * The pins a connection sets while its instance is keyed: the one interface
 * an unnamed connection is for, or every interface the connection's `id`
 * pins on the module.
 */
export function connectionOverrides(
  module: BindingModule,
  interfaceName: string,
  connection: BindingConnection,
): Map<string, string> {
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

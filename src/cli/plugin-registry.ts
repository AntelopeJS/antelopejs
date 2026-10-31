import { formatHelpItem, helpWidth } from "../core/output";

const PLUGIN_NAME_WIDTH = 9;

interface OfficialPluginDefinition {
  package: string;
  bin: string;
  description: string;
}

export interface OfficialPlugin extends OfficialPluginDefinition {
  name: string;
}

const OFFICIAL_PLUGIN_DEFINITIONS = new Map<string, OfficialPluginDefinition>([
  [
    "dms",
    {
      package: "@antelopejs/dms-frontend",
      bin: "ajs-dms",
      description: "DMS frontend commands",
    },
  ],
]);

export function findOfficialPlugin(name: string): OfficialPlugin | undefined {
  const definition = OFFICIAL_PLUGIN_DEFINITIONS.get(name);
  return definition ? { name, ...definition } : undefined;
}

export function listOfficialPlugins(): OfficialPlugin[] {
  return [...OFFICIAL_PLUGIN_DEFINITIONS].map(([name, definition]) => ({
    name,
    ...definition,
  }));
}

export function officialPluginLabel(plugin: OfficialPlugin): string {
  return plugin.name.toUpperCase();
}

export function officialPluginNames(): string[] {
  return [...OFFICIAL_PLUGIN_DEFINITIONS.keys()];
}

export function formatOfficialPluginsHelp(width: number = helpWidth()): string {
  return listOfficialPlugins()
    .flatMap((plugin) =>
      formatHelpItem(
        plugin.name,
        PLUGIN_NAME_WIDTH,
        `${plugin.description} (${plugin.package})`,
        width,
      ),
    )
    .join("\n");
}

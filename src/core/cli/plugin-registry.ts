interface OfficialPluginDefinition {
  package: string;
  bin: string;
  description: string;
}

export interface OfficialPlugin extends OfficialPluginDefinition {
  name: string;
}

const OFFICIAL_PLUGIN_DEFINITIONS: Record<string, OfficialPluginDefinition> = {
  dms: {
    package: "@antelopejs/dms-frontend",
    bin: "ajs-dms",
    description: "DMS frontend commands",
  },
};

export function findOfficialPlugin(name: string): OfficialPlugin | undefined {
  const definition = OFFICIAL_PLUGIN_DEFINITIONS[name];
  return definition ? { name, ...definition } : undefined;
}

export function listOfficialPlugins(): OfficialPlugin[] {
  return Object.entries(OFFICIAL_PLUGIN_DEFINITIONS).map(
    ([name, definition]) => ({ name, ...definition }),
  );
}

export function officialPluginLabel(plugin: OfficialPlugin): string {
  return plugin.name.toUpperCase();
}

export function officialPluginNames(): string[] {
  return Object.keys(OFFICIAL_PLUGIN_DEFINITIONS);
}

export function formatOfficialPluginsHelp(): string {
  return listOfficialPlugins()
    .map(
      (plugin) =>
        `  ${plugin.name.padEnd(10)} ${plugin.description} (${plugin.package})`,
    )
    .join("\n");
}

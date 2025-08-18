import { LoadConfig } from '../../../../common/config';

export async function selectNpmModulesToUpdate(
  requestedModules: string[],
  project: string,
  env?: string,
): Promise<string[]> {
  const antelopeConfig = await LoadConfig(project, env || 'default');
  const installed = Object.entries(antelopeConfig.modules)
    .filter(([, info]) => info.source?.type === 'package')
    .map(([name]) => name);

  return requestedModules.length > 0 ? requestedModules.filter((m) => installed.includes(m)) : installed;
}

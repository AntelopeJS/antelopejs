import { AntelopeProjectEnvConfigStrict } from '../../../../common/config';
import { ModuleSourcePackage } from '../../../../common/downloader/package';
import { ModuleSource } from '../../../../common/downloader';
import { ExecuteCMD, CommandResult } from '../../../../utils/command';
import { parsePackageInfoOutput } from '../../../../utils/package-manager';
import { error } from '../../../../utils/cli-ui';
import chalk from 'chalk';
import { UpdateReport, ModuleUpdateResult } from './reporter';
import { UpdateOptions } from './types';

export async function evaluateModules(
  moduleNames: string[],
  options: UpdateOptions,
  envConfig: AntelopeProjectEnvConfigStrict,
): Promise<UpdateReport> {
  const report = new UpdateReport();

  for (const name of moduleNames) {
    const result = await processSingleModule(name, options, envConfig);
    report.add(result);
  }

  return report;
}

async function processSingleModule(
  name: string,
  options: UpdateOptions,
  envConfig: AntelopeProjectEnvConfigStrict,
): Promise<ModuleUpdateResult> {
  const moduleInfo = envConfig.modules[name];
  if (!moduleInfo) return { name, status: 'notFound' };

  if (!isNpmModule(moduleInfo)) return { name, status: 'skipped' };

  const latest = await fetchLatestVersion(name);
  if (!latest) return { name, status: 'skipped' };

  const current = (moduleInfo.source as ModuleSourcePackage).version;
  if (latest === current) return { name, status: 'current', current };

  if (!options.dryRun) {
    (envConfig.modules[name].source as ModuleSourcePackage).version = latest;
  }
  return { name, status: 'updated', current, latest };
}

function isNpmModule(moduleInfo: { source: ModuleSource }): moduleInfo is { source: ModuleSourcePackage } {
  return moduleInfo?.source?.type === 'package';
}

async function fetchLatestVersion(moduleName: string): Promise<string | null> {
  const result: CommandResult = await ExecuteCMD(`npm view ${moduleName} version`, {}).catch((e: unknown) => ({
    code: 1,
    stderr: e instanceof Error ? e.message : String(e),
    stdout: '',
  }));

  if (result.code) {
    error(chalk.red`${chalk.bold(moduleName)}: Failed to fetch version: ${result.stderr}`);
    return null;
  }
  return parsePackageInfoOutput(result.stdout);
}

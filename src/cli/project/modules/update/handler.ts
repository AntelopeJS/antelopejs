import chalk from 'chalk';
import { AntelopeConfig, AntelopeProjectEnvConfigStrict } from '../../../../common/config';
import { readConfig, writeConfig } from '../../../common';
import { error, info } from '../../../../utils/cli-ui';
import { selectNpmModulesToUpdate } from './utils';
import { evaluateModules } from './evaluator';
import { renderReport } from './reporter';
import { UpdateOptions } from './types';

export async function handleUpdateCommand(modules: string[], options: UpdateOptions): Promise<boolean> {
  info(chalk.blue`Checking for module updates...`);

  const projectConfig = await loadProjectConfig(options.project);
  if (!projectConfig) return false;

  const envConfig = getEnvironmentConfig(projectConfig, options.env);
  if (!envConfig) return false;

  const npmModules = await selectNpmModulesToUpdate(modules, options.project, options.env);
  if (npmModules.length === 0) {
    error(chalk.red`No npm modules found to update`);
    info(`Only npm modules can be automatically updated.`);
    return false;
  }

  const report = await evaluateModules(npmModules, options, envConfig);

  if (!options.dryRun) await saveUpdatedConfig(projectConfig, options.project);

  renderReport(report, options.dryRun);
  return true;
}

async function loadProjectConfig(projectPath: string): Promise<AntelopeConfig | false> {
  const config = await readConfig(projectPath);
  if (!config) {
    error(chalk.red`No project configuration found at: ${projectPath}`);
    info(`Make sure you're in an AntelopeJS project or use the --project option.`);
    return false;
  }
  return config;
}

function getEnvironmentConfig(projectConfig: AntelopeConfig, envName?: string): AntelopeProjectEnvConfigStrict | null {
  const env = envName ? projectConfig?.environments?.[envName] : projectConfig;
  if (!env) {
    error(chalk.red`Environment ${envName || 'default'} not found in project config`);
    return null;
  }

  if (!env.modules || Object.keys(env.modules).length === 0) {
    error(chalk.red`No modules installed in this environment`);
    return null;
  }
  return env as AntelopeProjectEnvConfigStrict;
}

async function saveUpdatedConfig(projectConfig: AntelopeConfig, projectPath: string) {
  await writeConfig(projectPath, projectConfig);
}

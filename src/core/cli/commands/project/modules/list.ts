import chalk from 'chalk';
import { Command, Option } from 'commander';
import { ConfigLoader } from '../../../../config';
import { NodeFileSystem } from '../../../../filesystem';
import { Options, readConfig } from '../../../common';
import { displayBox, error, info, keyValue, warning } from '../../../cli-ui';
import { ModuleSourceGit, ModuleSourceLocal, ModuleSourceLocalFolder, ModuleSourcePackage } from '../../../../../types';

interface ListOptions {
  project: string;
  env?: string;
}

interface ModuleEntry {
  source?: unknown;
}

type KnownModuleSource = ModuleSourcePackage | ModuleSourceGit | ModuleSourceLocal | ModuleSourceLocalFolder;
type SourceDisplayHandler = (source: KnownModuleSource) => string[];

const SOURCE_DISPLAY_HANDLERS: Record<string, SourceDisplayHandler> = {
  package: (source) => {
    const packageSource = source as ModuleSourcePackage;
    return [
      `  ${keyValue('Type', chalk.green('npm package'))}`,
      `  ${keyValue('Package', packageSource.package)}`,
      `  ${keyValue('Version', packageSource.version)}`,
    ];
  },
  git: (source) => {
    const gitSource = source as ModuleSourceGit;
    const lines = [`  ${keyValue('Type', chalk.blue('git repository'))}`, `  ${keyValue('Remote', gitSource.remote)}`];
    if (gitSource.branch) {
      lines.push(`  ${keyValue('Branch', gitSource.branch)}`);
    }
    if (gitSource.commit) {
      lines.push(`  ${keyValue('Commit', gitSource.commit.substring(0, 8))}`);
    }
    return lines;
  },
  local: (source) => {
    const localSource = source as ModuleSourceLocal;
    return [`  ${keyValue('Type', chalk.yellow('local directory'))}`, `  ${keyValue('Path', localSource.path)}`];
  },
  'local-folder': (source) => {
    const localSource = source as ModuleSourceLocalFolder;
    return [`  ${keyValue('Type', chalk.yellow('local directory'))}`, `  ${keyValue('Path', localSource.path)}`];
  },
};

function createUnknownSourceLines(source: unknown): string[] {
  return [`  ${keyValue('Type', chalk.gray('unknown'))}`, `  ${keyValue('Source', JSON.stringify(source))}`];
}

function formatSourceLines(source: unknown): string[] {
  if (!source || typeof source !== 'object') {
    return createUnknownSourceLines(source);
  }
  const sourceType = (source as { type?: string }).type;
  if (!sourceType) {
    return createUnknownSourceLines(source);
  }
  const handler = SOURCE_DISPLAY_HANDLERS[sourceType];
  return handler ? handler(source as KnownModuleSource) : createUnknownSourceLines(source);
}

function createListTitle(projectName: string, env?: string): string {
  const environmentSuffix = env ? ` (${chalk.yellow(env)})` : '';
  return `📦 Installed Modules: ${chalk.cyan(projectName)}${environmentSuffix}`;
}

function createEmptyContent(): string {
  return `${chalk.dim('No modules installed in this project.')}\n\nUse ${chalk.bold('ajs project modules add <module>')} to add modules.`;
}

function appendModuleContent(content: string, moduleName: string, moduleConfig: ModuleEntry): string {
  const lines = formatSourceLines(moduleConfig.source);
  const moduleText = [`${chalk.bold.blue('●')} ${chalk.bold(moduleName)}`, ...lines].join('\n');
  return `${content}${moduleText}\n\n`;
}

export default function () {
  return new Command('list')
    .alias('ls')
    .description(
      `List installed modules in your project\n` +
        `Display all modules configured in the project with their source information.`,
    )
    .addOption(Options.project)
    .addOption(new Option('-e, --env <environment>', 'Environment to list modules from').env('ANTELOPEJS_LAUNCH_ENV'))
    .action(async (options: ListOptions) => {
      console.log('');

      const config = await readConfig(options.project);
      if (!config) {
        error(`No project configuration found at: ${chalk.bold(options.project)}`);
        warning(`Make sure you're in an AntelopeJS project or use the --project option.`);
        process.exitCode = 1;
        return;
      }

      const loader = new ConfigLoader(new NodeFileSystem());
      const antelopeConfig = await loader.load(options.project, options.env || 'default');
      const moduleEntries = Object.entries(antelopeConfig.modules as Record<string, ModuleEntry>);
      const title = createListTitle(config.name, options.env);

      if (moduleEntries.length === 0) {
        await displayBox(createEmptyContent(), title, {
          padding: 1,
          borderColor: 'yellow',
        });
        return;
      }

      let content = '';
      for (const [moduleName, moduleConfig] of moduleEntries) {
        content = appendModuleContent(content, moduleName, moduleConfig);
      }

      await displayBox(content.trim(), title, {
        padding: 1,
        borderColor: 'green',
      });

      info(`Found ${chalk.bold(moduleEntries.length)} module${moduleEntries.length === 1 ? '' : 's'} installed.`);
    });
}

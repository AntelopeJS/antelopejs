import chalk from 'chalk';
import { Command, Option } from 'commander';
import { build, DEFAULT_ENV } from '../../../..';
import { readBuildArtifact } from '../../../build/build-artifact';
import { Options } from '../../common';
import { displayBox, error, info, success } from '../../cli-ui';
import { ProjectCommandOptions, resolveInheritedVerbose, validateProjectExists } from '../shared/project-command';

interface BuildCommandOptions extends ProjectCommandOptions {
  project: string;
}
const MINUTE_IN_MILLISECONDS = 60000;

function formatBuildDuration(durationMs: number): string {
  if (durationMs < MINUTE_IN_MILLISECONDS) {
    return `${durationMs}ms`;
  }

  const minutes = Math.floor(durationMs / MINUTE_IN_MILLISECONDS);
  const remainingMs = durationMs % MINUTE_IN_MILLISECONDS;
  return `${minutes}m ${remainingMs}ms`;
}

function normalizeOptions(command: Command, options: BuildCommandOptions): BuildCommandOptions {
  return {
    ...options,
    verbose: resolveInheritedVerbose(command, options.verbose),
  };
}

async function showBuildConfiguration(options: BuildCommandOptions): Promise<void> {
  await displayBox(
    `Environment: ${chalk.cyan(options.env ?? DEFAULT_ENV)}\n` +
      `Project: ${chalk.cyan(options.project)}\n` +
      `Output: ${chalk.cyan('.antelope/build/build.json')}`,
    '󱌢 Build Configuration',
    { padding: 1 },
  );
}

async function displayBuildSummary(projectFolder: string, buildDuration: number): Promise<void> {
  const artifact = await readBuildArtifact(projectFolder);
  const moduleCount = Object.keys(artifact.modules).length;
  const formattedDuration = formatBuildDuration(buildDuration);
  success(`Build completed: ${moduleCount} module(s) prepared in ${formattedDuration}`);
}

export default function () {
  return new Command('build')
    .description(
      `Build your AntelopeJS project\n` +
        `Downloads modules, validates the module graph, and writes a build artifact for fast production startup.`,
    )
    .addOption(Options.project)
    .addOption(Options.verbose)
    .addOption(
      new Option('-e, --env <environment>', 'Environment to use for build validation').env('ANTELOPEJS_LAUNCH_ENV'),
    )
    .action(async function (this: Command, options: BuildCommandOptions) {
      const commandOptions = normalizeOptions(this, options);
      console.log('');

      const hasProject = await validateProjectExists(commandOptions.project);
      if (!hasProject) {
        return;
      }

      console.log('');
      await showBuildConfiguration(commandOptions);

      console.log('');
      info(`Building AntelopeJS project`);

      const startedAt = Date.now();
      try {
        await build(commandOptions.project, commandOptions.env ?? DEFAULT_ENV, {
          verbose: commandOptions.verbose,
        });
        await displayBuildSummary(commandOptions.project, Date.now() - startedAt);
      } catch (err) {
        error(err instanceof Error ? err.message : `Unknown error: ${String(err)}`);
        process.exitCode = 1;
      }
    });
}

import chalk from 'chalk';
import { Command } from 'commander';
import path, { basename } from 'path';
import { mkdir, readdir, stat, rm, readFile } from 'fs/promises';
import { Options, readModuleManifest } from '../../common';
import { ExecuteCMD } from '../../../utils/command';
import { displayBox, error, warning, Spinner, info } from '../../../utils/cli-ui';

interface GenerateOptions {
  module: string;
}

/**
 * Reads tsconfig.json to get the outDir value
 */
async function readTsConfigOutDir(tsConfigPath: string): Promise<string | null> {
  try {
    const tsConfigContent = await readFile(tsConfigPath, 'utf8');
    const tsConfig = JSON.parse(tsConfigContent);
    return tsConfig.compilerOptions?.outDir || null;
  } catch (err) {
    error(`Error reading tsconfig.json: ${err}`);
    return null;
  }
}

/**
 * Moves files from interface folder to the root output directory
 */
async function moveInterfaceFilesToRoot(
  interfaceFolderPath: string,
  outputPath: string,
  tmpPath: string,
): Promise<boolean> {
  try {
    const interfaceFolderExists = await stat(interfaceFolderPath).catch(() => false);
    if (!interfaceFolderExists) {
      return false;
    }

    // First, create a temporary directory to store interface files
    await mkdir(tmpPath, { recursive: true });

    // Copy interface files to temp directory
    const cpToTempCommand = `cp -R ${interfaceFolderPath}/* ${tmpPath}/`;
    const cpResult = await ExecuteCMD(cpToTempCommand, {});

    if (cpResult.code !== 0) {
      return false;
    }

    // Delete everything in the output directory except the temp folder
    const entries = await readdir(outputPath);
    for (const entry of entries) {
      if (entry !== basename(tmpPath)) {
        const entryPath = path.join(outputPath, entry);
        await rm(entryPath, { recursive: true, force: true });
      }
    }

    // Move files from temp directory to output root
    const mvFromTempCommand = `cp -R ${tmpPath}/* ${outputPath}/ && rm -rf ${tmpPath}`;
    const mvResult = await ExecuteCMD(mvFromTempCommand, {});

    if (mvResult.code !== 0) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Deletes the output directory if it exists
 */
async function cleanOutputDirectory(outputDir: string): Promise<boolean> {
  try {
    const dirExists = await stat(outputDir).catch(() => false);
    if (dirExists) {
      await rm(outputDir, { recursive: true, force: true });
    }
    return true;
  } catch (err) {
    error(`Error cleaning output directory: ${err}`);
    return false;
  }
}

export default function () {
  return new Command('generate')
    .description(
      `Generate module exports definition\n` + `Creates TypeScript definition files for your module's exports.`,
    )
    .addOption(Options.module)
    .action(async (options: GenerateOptions) => {
      console.log(''); // Add spacing for better readability

      // Load the module manifest to get the exports path
      const manifest = await readModuleManifest(options.module);
      if (!manifest) {
        error(`No package.json found in ${chalk.bold(options.module)}`);
        return;
      }

      // Check if exports path is configured
      if (!manifest.antelopeJs?.exportsPath) {
        error(`Exports path not configured in ${chalk.bold(options.module)}`);
        warning(`Please set the exports path using: ${chalk.cyan('ajs module exports set <path>')}`);
        return;
      }

      const exportPath = manifest.antelopeJs.exportsPath;
      const tsConfigFile = path.join(options.module, 'tsconfig.json');
      const outputPath = path.join(options.module, 'output');
      const tmpPath = path.join(options.module, '.antelope', 'tmp');

      info(`Generating TypeScript declarations for ${chalk.cyan(exportPath)}`);
      info(`Output directory: ${chalk.cyan(outputPath)}`);

      // Clean the output directory first
      const cleanSpinner = new Spinner('Cleaning output directory');
      await cleanSpinner.start();

      const cleanResult = await cleanOutputDirectory(outputPath);
      if (!cleanResult) {
        await cleanSpinner.fail('Failed to clean output directory');
        return;
      }

      await cleanSpinner.succeed('Output directory cleaned');

      const spinner = new Spinner('Running TypeScript compiler');
      await spinner.start();

      try {
        // Run TypeScript compiler to generate declaration files
        // Only compile files from the source directory and output to the exports path
        const tscCommand = [
          'npx tsc',
          '--emitDeclarationOnly',
          '-d',
          '--stripInternal',
          '--removeComments false',
          `--project ${tsConfigFile}`,
          `--outDir ${outputPath}`,
        ].join(' ');

        const result = await ExecuteCMD(tscCommand, { cwd: options.module });

        if (result.code !== 0) {
          await spinner.fail('Failed to generate declarations');
          error(result.stderr);
          return;
        }

        // Get outDir from tsconfig.json
        const tsConfigOutDir = await readTsConfigOutDir(tsConfigFile);
        if (!tsConfigOutDir) {
          await spinner.fail('Could not determine outDir from tsconfig.json');
          return;
        }

        // Calculate the interface folder path
        const interfaceFolderPath = path.join(outputPath, exportPath.replace(tsConfigOutDir, ''));

        // Move interface files to root and clean up
        const moveResult = await moveInterfaceFilesToRoot(interfaceFolderPath, outputPath, tmpPath);
        if (!moveResult) {
          await spinner.fail('Failed to finalize interface files');
          return;
        }

        await spinner.succeed('TypeScript declarations generated successfully');

        await displayBox(
          `Module exports have been generated at ${chalk.green(outputPath)}\n\n` +
            `These definition files can now be imported by other modules.`,
          '🎉 Exports Generated',
          {
            padding: 1,
            borderColor: 'green',
          },
        );
      } catch (err) {
        await spinner.fail('Failed to generate declarations');
        error(`${err}`);

        await displayBox(
          `Error running TypeScript compiler.\n\n` +
            `Ensure TypeScript is installed and your tsconfig.json is properly configured.`,
          '❌ Generation Failed',
          {
            padding: 1,
            borderColor: 'red',
          },
        );
      }
    });
}

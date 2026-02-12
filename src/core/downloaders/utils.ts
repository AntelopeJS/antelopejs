import * as os from 'os';
import { CommandRunner, DebugLogger } from './types';
import { ModuleInstallCommand } from '../../types';
import { terminalDisplay } from '../cli/terminal-display';

export function normalizeCommands(installCommand?: ModuleInstallCommand): string[] {
  if (!installCommand) {
    return [];
  }
  return Array.isArray(installCommand) ? installCommand : [installCommand];
}

export async function runInstallCommands(
  exec: CommandRunner,
  logger: DebugLogger,
  label: string,
  folder: string,
  installCommand?: ModuleInstallCommand,
): Promise<void> {
  const commands = normalizeCommands(installCommand);
  if (commands.length === 0) {
    return;
  }

  await terminalDisplay.startSpinner(`Installing dependencies for ${label}`);
  for (const command of commands) {
    logger.Debug(`Executing command: ${command}`);
    const result = await exec(command, { cwd: folder });
    if (result.code !== 0) {
      await terminalDisplay.failSpinner(`Failed to install dependencies: ${result.stderr}`);
      throw new Error(`Failed to install dependencies: ${result.stderr || result.stdout}`);
    }
  }
  await terminalDisplay.stopSpinner(`Dependencies installed for ${label}`);
}

export function expandHome(input: string): string {
  const homeDir = os.homedir();

  if (input.startsWith('~')) {
    return homeDir + input.slice(1);
  }

  if (input.includes('~')) {
    const parts = input.split('~');
    if (parts[0].startsWith(homeDir)) {
      return homeDir + '/' + parts[1].replace(/^\/+/, '');
    }
    return input.replace(/~/g, homeDir).replace(/\/+/, '/');
  }

  return input;
}

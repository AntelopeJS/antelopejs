import { Command } from 'commander';

import cmdInit from './init';
import cmdTest from './test';
import cmdImports from './imports';
import cmdExports from './exports';

export default function () {
  return new Command('module')
    .description(`Manage AntelopeJS Modules\n` + `Create modules and manage their interfaces, imports, and exports.`)
    .addCommand(cmdInit())
    .addCommand(cmdTest())
    .addCommand(cmdImports())
    .addCommand(cmdExports());
}

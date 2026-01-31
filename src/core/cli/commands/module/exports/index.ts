import { Command } from 'commander';

import cmdSet from './set';
import cmdGenerate from './generate';

export default function () {
  return new Command('exports')
    .description(`Manage module exports\n` + `Configure which interfaces your module provides to other modules.`)
    .addCommand(cmdSet())
    .addCommand(cmdGenerate());
}

import { Command } from 'commander';

import cmdShow from './show';
import cmdGet from './get';
import cmdSet from './set';
import cmdReset from './reset';

export default function () {
  return new Command('config')
    .description(`Manage CLI Configuration\n` + `View and change settings for the AntelopeJS CLI.`)
    .addCommand(cmdShow())
    .addCommand(cmdGet())
    .addCommand(cmdSet())
    .addCommand(cmdReset());
}

import { Command } from 'commander';

import cmdInit from './init';
import cmdModule from './modules';
import cmdLogging from './logging';
import cmdDev from './dev';
import cmdBuild from './build';
import cmdStart from './start';
import cmdRun from './run';

export default function () {
  return new Command('project')
    .description(
      `Manage AntelopeJS Projects\n` + `Create, configure, and run projects that bring together different modules.`,
    )
    .addCommand(cmdInit())
    .addCommand(cmdModule())
    .addCommand(cmdLogging())
    .addCommand(cmdDev())
    .addCommand(cmdBuild())
    .addCommand(cmdStart())
    .addCommand(cmdRun());
}

import { Command } from 'commander';

import cmdAdd from './add';
import cmdRemove from './remove';
import cmdUpdate from './update';
import cmdFix from './fix';
import cmdList from './list';

export default function () {
  return new Command('modules')
    .description(`Manage modules in your AntelopeJS project\n` + `Add, remove, update and fix modules in your project.`)
    .addCommand(cmdAdd())
    .addCommand(cmdRemove())
    .addCommand(cmdUpdate())
    .addCommand(cmdFix())
    .addCommand(cmdList());
}

import { Command } from 'commander';

import cmdShow from './show';
import cmdSet from './set';

export default function () {
  return new Command('logging')
    .description(`Configure and view project logging\n` + `Manage logging configuration and view log output`)
    .addCommand(cmdShow())
    .addCommand(cmdSet());
}

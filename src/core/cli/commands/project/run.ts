import { createDevCommand } from './dev';

const RUN_DESCRIPTION = `Alias for "dev". Run your AntelopeJS project in development mode.`;

export default function () {
  return createDevCommand({
    name: 'run',
    description: RUN_DESCRIPTION,
  });
}

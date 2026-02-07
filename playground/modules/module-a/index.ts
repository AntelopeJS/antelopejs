import { ImplementInterface } from '@ajs/core/beta';
import { Greeter } from './interfaces/greeter/v1';

let config: { prefix: string };

export async function construct(moduleConfig: { prefix: string }) {
  config = moduleConfig;
  ImplementInterface(Greeter, {
    greet: (name: string) => `${config.prefix}, ${name}!`,
  });
  console.log('[module-a] Constructed with config:', config);
}

export function start() {
  console.log('[module-a] Started');
}

export function stop() {
  console.log('[module-a] Stopped');
}

export async function destroy() {
  console.log('[module-a] Destroyed');
  config = undefined!;
}

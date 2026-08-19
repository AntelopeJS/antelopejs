import { formatMessage } from "./message.mjs";

const ready = await Promise.resolve(true);
let config;

export function construct(moduleConfig) {
  config = moduleConfig;
}

export function start() {
  if (ready) {
    console.log(formatMessage(config.message));
  }
}

export function stop() {}

export function destroy() {
  config = undefined;
}

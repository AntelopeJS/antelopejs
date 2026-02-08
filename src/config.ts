import { AntelopeConfig } from './types/config.types';

export { AntelopeConfig };

export interface ConfigContext {
  env: string;
}

export type ConfigInput = AntelopeConfig | ((ctx: ConfigContext) => AntelopeConfig | Promise<AntelopeConfig>);

export function defineConfig(input: ConfigInput): ConfigInput {
  return input;
}

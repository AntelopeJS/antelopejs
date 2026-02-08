import { expect } from 'chai';
import { defineConfig, ConfigContext, ConfigInput } from '../src/config';
import { AntelopeConfig } from '../src/types/config.types';

describe('defineConfig', () => {
  it('should accept an AntelopeConfig object and return it as-is', () => {
    const config: AntelopeConfig = {
      name: 'test-project',
      modules: { 'my-module': '1.0.0' },
    };

    const result = defineConfig(config);

    expect(result).to.equal(config);
  });

  it('should accept a sync callback and return it as-is', () => {
    const callback = (ctx: ConfigContext): AntelopeConfig => ({
      name: `project-${ctx.env}`,
    });

    const result = defineConfig(callback);

    expect(result).to.equal(callback);
  });

  it('should accept an async callback and return it as-is', () => {
    const callback = async (ctx: ConfigContext): Promise<AntelopeConfig> => ({
      name: `project-${ctx.env}`,
    });

    const result = defineConfig(callback);

    expect(result).to.equal(callback);
  });

  it('should return the exact same reference as the input', () => {
    const config: AntelopeConfig = { name: 'identity-check' };
    const syncFn: ConfigInput = (_ctx: ConfigContext) => ({ name: 'sync' });
    const asyncFn: ConfigInput = async (_ctx: ConfigContext) => ({ name: 'async' });

    expect(defineConfig(config)).to.equal(config);
    expect(defineConfig(syncFn)).to.equal(syncFn);
    expect(defineConfig(asyncFn)).to.equal(asyncFn);
  });
});

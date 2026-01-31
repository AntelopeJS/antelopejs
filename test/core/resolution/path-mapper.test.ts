import { expect } from 'chai';
import * as path from 'path';
import { PathMapper } from '../../../src/core/resolution/path-mapper';

const manifest = {
  srcAliases: [{ alias: '@src', replace: '/mod/src' }],
  paths: [
    {
      key: '@lib/',
      values: ['/mod/src/lib'],
    },
  ],
} as any;

describe('PathMapper', () => {
  it('should resolve aliases', () => {
    const mapper = new PathMapper(() => false);
    const result = mapper.resolve('@src/utils', manifest);

    expect(result).to.equal(path.join('/mod/src', 'utils'));
  });

  it('should resolve mapped paths when target exists', () => {
    const existing = new Set<string>(['/mod/src/lib/util.js']);
    const mapper = new PathMapper((p) => existing.has(p));

    const result = mapper.resolve('@lib/util', manifest);

    expect(result).to.equal(path.join('/mod/src/lib', 'util'));
  });
});

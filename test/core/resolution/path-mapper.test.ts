import { expect } from 'chai';
import * as path from 'path';
import { cleanupTempDir, makeTempDir } from '../../helpers/temp';
import { mkdirSync, writeFileSync } from 'fs';
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

  it('should resolve alias without suffix', () => {
    const mapper = new PathMapper(() => false);
    const result = mapper.resolve('@src', manifest);

    expect(result).to.equal('/mod/src');
  });

  it('should resolve mapped paths when target exists', () => {
    const existing = new Set<string>(['/mod/src/lib/util.js']);
    const mapper = new PathMapper((p) => existing.has(p));

    const result = mapper.resolve('@lib/util', manifest);

    expect(result).to.equal(path.join('/mod/src/lib', 'util'));
  });

  it('should resolve index.js when present', () => {
    const existing = new Set<string>(['/mod/src/lib/util/index.js']);
    const mapper = new PathMapper((p) => existing.has(p));

    const result = mapper.resolve('@lib/util', manifest);

    expect(result).to.equal(path.join('/mod/src/lib', 'util'));
  });

  it('should use the first matching value', () => {
    const mapper = new PathMapper((p) => p === '/second/util.js');
    const custom = {
      paths: [{ key: '@lib/', values: ['/first', '/second'] }],
    } as any;

    const result = mapper.resolve('@lib/util', custom);

    expect(result).to.equal(path.join('/second', 'util'));
  });

  it('should return undefined when no mappings match', () => {
    const mapper = new PathMapper(() => false);
    const result = mapper.resolve('@missing/util', manifest);

    expect(result).to.equal(undefined);
  });

  it('should use default filesystem exists check', () => {
    const tempDir = makeTempDir();
    try {
      const libDir = path.join(tempDir, 'src', 'lib');
      mkdirSync(libDir, { recursive: true });
      writeFileSync(path.join(libDir, 'util.js'), '// util');

      const mapper = new PathMapper();
      const result = mapper.resolve('@lib/util', {
        paths: [{ key: '@lib/', values: [libDir] }],
      } as any);

      expect(result).to.equal(path.join(libDir, 'util'));
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  it('returns undefined when mapping matches but files are missing', () => {
    const mapper = new PathMapper(() => false);
    const result = mapper.resolve('@lib/missing', { paths: [{ key: '@lib/', values: ['/missing'] }] } as any);

    expect(result).to.equal(undefined);
  });

  it('falls back when default exists check fails', () => {
    const mapper = new PathMapper();
    const result = mapper.resolve('@lib/missing', { paths: [{ key: '@lib/', values: ['/nope'] }] } as any);

    expect(result).to.equal(undefined);
  });
});

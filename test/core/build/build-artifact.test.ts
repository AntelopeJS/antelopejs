import { expect } from 'chai';
import {
  computeConfigHash,
  createBuildArtifact,
  readBuildArtifact,
  writeBuildArtifact,
} from '../../../src/core/build/build-artifact';
import { InMemoryFileSystem } from '../../helpers/in-memory-filesystem';

describe('build artifact', () => {
  it('computes deterministic hashes for unchanged config', async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile(
      '/project/antelope.json',
      JSON.stringify({
        name: 'sample',
        modules: {
          zeta: { source: { type: 'local', path: './zeta' } },
          alpha: { source: { type: 'local', path: './alpha' } },
        },
      }),
    );
    await fs.writeFile('/project/antelope.alpha.json', JSON.stringify({ enabled: true }));
    await fs.writeFile('/project/antelope.zeta.json', JSON.stringify({ enabled: false }));

    const hashA = await computeConfigHash('/project', 'production', fs);
    const hashB = await computeConfigHash('/project', 'production', fs);
    const hashC = await computeConfigHash('/project', 'staging', fs);

    expect(hashA).to.equal(hashB);
    expect(hashA).to.not.equal(hashC);
  });

  it('writes and reads build artifacts', async () => {
    const fs = new InMemoryFileSystem();
    const artifact = createBuildArtifact({
      configHash: 'abc123',
      env: 'production',
      config: {
        name: 'sample',
        cacheFolder: '/project/.antelope/cache',
        projectFolder: '/project',
        envOverrides: {},
      },
      modules: {},
      buildTime: '2026-01-01T00:00:00.000Z',
    });

    await writeBuildArtifact('/project', artifact, fs);
    const loaded = await readBuildArtifact('/project', fs);

    expect(loaded.version).to.equal(artifact.version);
    expect(loaded.env).to.equal('production');
    expect(loaded.configHash).to.equal('abc123');
    expect(loaded.buildTime).to.equal('2026-01-01T00:00:00.000Z');
    expect(loaded.modules).to.deep.equal({});
  });
});

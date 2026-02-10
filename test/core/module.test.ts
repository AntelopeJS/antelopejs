import { expect } from 'chai';
import sinon from 'sinon';
import { Module } from '../../src/core/module';
import { ModuleState } from '../../src/types';

const manifest = {
  name: 'mod',
  version: '1.0.0',
  main: '/mod/index.js',
} as any;

describe('Module', () => {
  it('exposes current state', () => {
    const mod = new Module(manifest, sinon.stub().resolves({}));
    expect(mod.state).to.equal(ModuleState.Loaded);
  });

  it('should load and run lifecycle callbacks', async () => {
    const callbacks = {
      construct: sinon.spy(),
      start: sinon.spy(),
      stop: sinon.spy(),
      destroy: sinon.spy(),
    };

    const loader = sinon.stub().resolves(callbacks);
    const mod = new Module(manifest, loader);

    await mod.construct({ foo: 'bar' });
    mod.start();
    await mod.stop();
    await mod.destroy();

    expect(loader.calledOnce).to.be.true;
    expect(callbacks.construct.calledOnce).to.be.true;
    expect(callbacks.start.calledOnce).to.be.true;
    expect(callbacks.stop.calledOnce).to.be.true;
    expect(callbacks.destroy.calledOnce).to.be.true;
  });

  it('should not reload callbacks when already constructed', async () => {
    const loader = sinon.stub().resolves({});
    const mod = new Module(manifest, loader);

    await mod.construct({});
    await mod.construct({});

    expect(loader.calledOnce).to.equal(true);
  });

  it('should reload manifest and update version', async () => {
    const reloadManifest = {
      ...manifest,
      version: '1.0.0',
      reload: sinon.stub(),
    } as any;
    reloadManifest.reload.callsFake(async () => {
      reloadManifest.version = '1.0.1';
    });

    const loader = sinon.stub().resolves({});
    const mod = new Module(reloadManifest, loader);

    await mod.reload();

    expect(reloadManifest.reload.calledOnce).to.equal(true);
    expect(mod.version).to.equal('1.0.1');
  });

  it('should await async stop callback', async () => {
    let stopResolved = false;
    const callbacks = {
      stop: async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
        stopResolved = true;
      },
    };

    const loader = sinon.stub().resolves(callbacks);
    const mod = new Module(manifest, loader);

    await mod.construct({});
    mod.start();
    await mod.stop();

    expect(stopResolved).to.equal(true);
  });
});

import { expect } from 'chai';
import { ModuleTracker } from '../../src/core/module-tracker';
import { internal } from '../../src/interfaces/core/beta';

describe('ModuleTracker', () => {
  beforeEach(() => {
    internal.moduleByFolder.splice(0, internal.moduleByFolder.length);
  });

  it('should add and remove module entries', () => {
    const tracker = new ModuleTracker();

    tracker.add({ id: 'modA', dir: '/modA', interfaceDir: '/modA/interfaces' });
    tracker.add({ id: 'modB', dir: '/modB', interfaceDir: '/modB/interfaces' });

    expect(internal.moduleByFolder).to.have.length(2);

    tracker.remove('modA');

    expect(internal.moduleByFolder).to.have.length(1);
    expect(internal.moduleByFolder[0].id).to.equal('modB');
  });

  it('should clear all module entries', () => {
    const tracker = new ModuleTracker();

    tracker.add({ id: 'modA', dir: '/modA', interfaceDir: '/modA/interfaces' });
    tracker.clear();

    expect(internal.moduleByFolder).to.have.length(0);
  });
});

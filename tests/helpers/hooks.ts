import sinon from 'sinon';

// Mocha root hooks for automatic cleanup
export const mochaHooks = {
  afterEach() {
    sinon.restore();
  },
};

import { expect } from 'chai';
import * as sinon from 'sinon';
import { Spinner, success, error, warning, info } from '../../../src/core/cli/cli-ui';

describe('CLI UI', () => {
  describe('Spinner', () => {
    let stdoutStub: sinon.SinonStub;

    beforeEach(() => {
      stdoutStub = sinon.stub(process.stdout, 'write');
    });

    afterEach(() => {
      stdoutStub.restore();
    });

    it('should create spinner with text', () => {
      const spinner = new Spinner('Loading...');
      expect(spinner).to.be.instanceOf(Spinner);
    });

    it('should update text', () => {
      const spinner = new Spinner('Initial');
      spinner.update('Updated');
    });

    it('should stop spinner', async () => {
      const spinner = new Spinner('Test');
      await spinner.start();
      await spinner.stop();
    });
  });

  describe('display functions', () => {
    it('should format success message', () => {
      expect(() => success('Done')).to.not.throw();
    });

    it('should format error message', () => {
      expect(() => error('Failed')).to.not.throw();
    });

    it('should format warning message', () => {
      expect(() => warning('Careful')).to.not.throw();
    });

    it('should format info message', () => {
      expect(() => info('Note')).to.not.throw();
    });
  });
});

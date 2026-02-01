import { expect } from 'chai';
import sinon from 'sinon';
import os from 'os';
import { expandHome } from '../../../src/core/downloaders/utils';

describe('Downloader utils', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('expands leading tilde', () => {
    sinon.stub(os, 'homedir').returns('/home/test');

    expect(expandHome('~')).to.equal('/home/test');
    expect(expandHome('~/work')).to.equal('/home/test/work');
  });

  it('expands mid-string tilde when prefix matches home', () => {
    sinon.stub(os, 'homedir').returns('/home/test');

    expect(expandHome('/home/test/projects~sub')).to.equal('/home/test/sub');
  });

  it('expands mid-string tilde when prefix differs', () => {
    sinon.stub(os, 'homedir').returns('/home/test');

    expect(expandHome('proj~backup')).to.equal('proj/home/testbackup');
  });

  it('returns input when no tilde exists', () => {
    sinon.stub(os, 'homedir').returns('/home/test');

    expect(expandHome('/opt/project')).to.equal('/opt/project');
  });
});

import { expect } from 'chai';
import path from 'path';

const STUB_PATH = path.resolve(__dirname, '../../../src/core/test/stub-interface');

describe('stub-interface', () => {
  beforeEach(() => {
    const resolved = require.resolve(STUB_PATH);
    delete require.cache[resolved];
  });

  it('returns truthy __esModule property', () => {
    const stub = require(STUB_PATH);
    expect(stub.__esModule).to.equal(true);
  });

  it('returns a callable stub for any named export', () => {
    const stub = require(STUB_PATH);
    const Greeter = stub.Greeter;
    expect(Greeter).to.not.equal(undefined);
  });

  it('throws when calling a method on a named export', () => {
    const stub = require(STUB_PATH);
    const Greeter = stub.Greeter;
    expect(() => Greeter.greet('test')).to.throw('without implementation');
  });

  it('throws when calling a nested property as function', () => {
    const stub = require(STUB_PATH);
    const Auth = stub.Auth;
    expect(() => Auth.login()).to.throw('without implementation');
  });

  it('provides proxy property on function stubs', () => {
    const stub = require(STUB_PATH);
    const Greeter = stub.Greeter;
    expect(Greeter.greet.proxy).to.not.equal(undefined);
  });
});

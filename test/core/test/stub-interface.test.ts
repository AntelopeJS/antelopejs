import { expect } from "chai";
const { stubInterface } = require("../../../src/core/test");

describe("stub-interface", () => {
  it("returns truthy __esModule property", () => {
    const stub = stubInterface;
    expect(stub.__esModule).to.equal(true);
  });

  it("returns a callable stub for any named export", () => {
    const stub = stubInterface;
    const Greeter = stub.Greeter;
    expect(Greeter).to.not.equal(undefined);
  });

  it("throws when calling a method on a named export", () => {
    const stub = stubInterface;
    const Greeter = stub.Greeter;
    expect(() => Greeter.greet("test")).to.throw("without implementation");
  });

  it("throws when calling a nested property as function", () => {
    const stub = stubInterface;
    const Auth = stub.Auth;
    expect(() => Auth.login()).to.throw("without implementation");
  });

  it("provides proxy property on function stubs", () => {
    const stub = stubInterface;
    const Greeter = stub.Greeter;
    expect(Greeter.greet.proxy).to.not.equal(undefined);
  });

  it("returns undefined for symbol properties on module proxy", () => {
    const stub = stubInterface;
    const sym = Symbol("test");
    expect(stub[sym]).to.equal(undefined);
  });

  it("returns undefined for symbol properties on property proxy", () => {
    const stub = stubInterface;
    const Greeter = stub.Greeter;
    const sym = Symbol("test");
    expect(Greeter[sym]).to.equal(undefined);
  });

  it("returns truthy __esModule on nested property proxy", () => {
    const stub = stubInterface;
    const Greeter = stub.Greeter;
    expect(Greeter.__esModule).to.equal(true);
  });
});

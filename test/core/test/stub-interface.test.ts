import { expect } from "chai";

import { stubInterface } from "../../../src/core/test";

type StubNamespace = (typeof stubInterface)[string];
type NamedExport = Exclude<StubNamespace, true>;
type StubMember = NamedExport[string];

function namedExport(value: StubNamespace): NamedExport {
  if (value === true) {
    throw new Error("expected a named export, got __esModule");
  }
  return value;
}

function stubFunction(value: StubMember): Exclude<StubMember, true> {
  if (value === true) {
    throw new Error("expected a stub function, got __esModule");
  }
  return value;
}

describe("stub-interface", () => {
  it("returns truthy __esModule property", () => {
    expect(stubInterface.__esModule).to.equal(true);
  });

  it("returns a callable stub for any named export", () => {
    const Greeter = namedExport(stubInterface.Greeter);
    expect(Greeter).to.not.equal(undefined);
  });

  it("throws when calling a method on a named export", () => {
    const greet = stubFunction(namedExport(stubInterface.Greeter).greet);
    expect(() => greet("test")).to.throw("without implementation");
  });

  it("throws when calling a nested property as function", () => {
    const login = stubFunction(namedExport(stubInterface.Auth).login);
    expect(() => login()).to.throw("without implementation");
  });

  it("provides proxy property on function stubs", () => {
    const greet = stubFunction(namedExport(stubInterface.Greeter).greet);
    expect(greet.proxy).to.not.equal(undefined);
  });

  it("returns undefined for symbol properties on module proxy", () => {
    const sym = Symbol("test");
    expect(stubInterface[sym]).to.equal(undefined);
  });

  it("returns undefined for symbol properties on property proxy", () => {
    const Greeter = namedExport(stubInterface.Greeter);
    const sym = Symbol("test");
    expect(Greeter[sym]).to.equal(undefined);
  });

  it("returns truthy __esModule on nested property proxy", () => {
    const Greeter = namedExport(stubInterface.Greeter);
    expect(Greeter.__esModule).to.equal(true);
  });
});

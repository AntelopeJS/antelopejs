import {
  AsyncProxy,
  EventProxy,
  InterfaceFunction,
  RegisteringProxy,
} from "@antelopejs/interface-core";
import { expect } from "chai";
import { neutralizeInterfaceAsyncProxies } from "../../../src/core/resolution/stub-interface-runtime";

describe("neutralizeInterfaceAsyncProxies", () => {
  it("makes AsyncProxy-backed calls reject instead of queuing forever", async () => {
    const iface = {
      doThing: InterfaceFunction<(x: number) => string>(),
    };
    neutralizeInterfaceAsyncProxies(iface, "test-iface");

    let error: Error | undefined;
    try {
      await iface.doThing(1);
    } catch (e) {
      error = e as Error;
    }
    expect(error).to.be.instanceOf(Error);
    expect(error?.message).to.match(/test-iface/);
    expect(error?.message).to.match(/no provider/);
  });

  it("recurses into nested namespaces", async () => {
    const iface = {
      group: {
        nested: {
          fn: InterfaceFunction<() => number>(),
        },
      },
    };
    neutralizeInterfaceAsyncProxies(iface, "nested-iface");

    let rejected = false;
    try {
      await iface.group.nested.fn();
    } catch {
      rejected = true;
    }
    expect(rejected).to.equal(true);
  });

  it("leaves RegisteringProxy untouched", () => {
    const reg = new RegisteringProxy<(id: string) => void>();
    const iface = { reg };
    neutralizeInterfaceAsyncProxies(iface, "reg-iface");

    let called = false;
    reg.onRegister(() => {
      called = true;
    }, true);
    reg.register("id-1");
    expect(called).to.equal(true);
  });

  it("leaves EventProxy untouched", () => {
    const event = new EventProxy<() => void>();
    const iface = { event };
    neutralizeInterfaceAsyncProxies(iface, "evt-iface");

    let fired = false;
    event.register(() => {
      fired = true;
    });
    event.emit();
    expect(fired).to.equal(true);
  });

  it("neutralizes bare AsyncProxy instances (not wrapped in InterfaceFunction)", async () => {
    const proxy = new AsyncProxy<() => number>();
    const iface = { proxy };
    neutralizeInterfaceAsyncProxies(iface, "bare-iface");

    let rejected = false;
    try {
      await proxy.call();
    } catch {
      rejected = true;
    }
    expect(rejected).to.equal(true);
  });

  it("does not loop on circular structures", () => {
    const iface: any = { a: {} };
    iface.a.back = iface;
    expect(() =>
      neutralizeInterfaceAsyncProxies(iface, "cycle-iface"),
    ).to.not.throw();
  });
});

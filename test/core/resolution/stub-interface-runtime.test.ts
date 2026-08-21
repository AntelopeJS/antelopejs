import {
  AsyncProxy,
  EventProxy,
  InterfaceFunction,
  RegisteringProxy,
} from "@antelopejs/interface-core";
import { internal } from "@antelopejs/interface-core/internal";
import { expect } from "chai";
import { ModuleLifecycle } from "../../../src/core/module-lifecycle";
import { neutralizeInterfaceAsyncProxies } from "../../../src/core/resolution/stub-interface-runtime";
import { ModuleState } from "../../../src/types";

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

  it("leaves RegisteringProxy behavior unchanged in test stub mode", () => {
    const reg = new RegisteringProxy<(id: string) => void>();
    const iface = { reg };
    neutralizeInterfaceAsyncProxies(iface, "reg-iface");

    internal.testStubMode = true;
    try {
      expect(() => reg.register("id-1")).to.throw();
      expect(() => reg.unregister("id-1")).to.not.throw();
    } finally {
      internal.testStubMode = false;
    }
  });

  it("replays registrations recorded while neutralized to a later provider", () => {
    const reg = new RegisteringProxy<(id: string) => void>();
    neutralizeInterfaceAsyncProxies({ reg }, "reg-iface");
    reg.register("id-1");

    const received: string[] = [];
    reg.onRegister((id) => received.push(id), true);
    expect(received).to.deep.equal(["id-1"]);
  });

  it("boots a module whose async start() registers into a stubbed optional interface", async () => {
    const reg = new RegisteringProxy<(id: string) => void>();
    neutralizeInterfaceAsyncProxies({ reg }, "optional-iface");

    const lifecycle = new ModuleLifecycle("mod-async-start");
    lifecycle.setCallbacks({
      start: async () => {
        await new Promise((resolve) => {
          setImmediate(resolve);
        });
        reg.register("trigger-1");
      },
    });

    await lifecycle.construct({});
    await lifecycle.start();
    internal.testStubMode = true;
    try {
      expect(lifecycle.state).to.equal(ModuleState.Active);
      expect(() => reg.register("trigger-2")).to.throw();
    } finally {
      internal.testStubMode = false;
    }
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

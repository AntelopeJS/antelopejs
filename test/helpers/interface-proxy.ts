import { AsyncProxy } from "@antelopejs/interface-core";
import type { Func } from "@antelopejs/interface-core/decorators";
import assert from "node:assert/strict";

export function interfaceProxy(fn: Func): AsyncProxy {
  const proxy: unknown = Object.getOwnPropertyDescriptor(fn, "proxy")?.value;
  assert.ok(proxy instanceof AsyncProxy);
  return proxy;
}

export function resetProxy(fn: Func): void {
  const proxy = interfaceProxy(fn);
  proxy.onCall(() => undefined, true);
  proxy.detach();
}

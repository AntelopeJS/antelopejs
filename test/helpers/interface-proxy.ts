import type { AsyncProxy } from "@antelopejs/interface-core";
import assert from "node:assert/strict";

import { AsyncProxyClass } from "../../src/core/resolution";

type Func = (...args: never[]) => void;

export function interfaceProxy(fn: Func): AsyncProxy {
  const proxy: unknown = Object.getOwnPropertyDescriptor(fn, "proxy")?.value;
  assert.ok(proxy instanceof AsyncProxyClass);
  return proxy;
}

export function resetProxy(fn: Func): void {
  const proxy = interfaceProxy(fn);
  proxy.onCall(() => undefined, true);
  proxy.detach();
}

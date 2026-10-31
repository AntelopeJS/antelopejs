import { AsyncProxy } from "@antelopejs/interface-core";
import assert from "node:assert/strict";

type Func = (...args: never[]) => void;

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

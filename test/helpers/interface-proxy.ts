import { AsyncProxy } from "@antelopejs/interface-core";
import assert from "node:assert/strict";

export function interfaceProxy<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
): AsyncProxy {
  const proxy: unknown = Object.getOwnPropertyDescriptor(fn, "proxy")?.value;
  assert.ok(proxy instanceof AsyncProxy);
  return proxy;
}

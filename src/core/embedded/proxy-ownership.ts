import {
  getModuleContext,
  internal,
  type RuntimeCleanup,
} from "@antelopejs/interface-core/internal";
import { isFunction } from "../../utils";

type OwnedProxy = RuntimeCleanup | { detach(): void; cleanup?: unknown };
type OwnedProxyMap = Map<string, Set<OwnedProxy>>;

const OWNERSHIP_MAPS: Array<(runtime: typeof internal) => OwnedProxyMap> = [
  (runtime) => runtime.knownAsync,
  (runtime) => runtime.knownRegisters,
];

function getOwnedProxies(owner: string): Set<OwnedProxy>[] {
  return OWNERSHIP_MAPS.map(
    (select) => select(internal).get(owner) ?? new Set<OwnedProxy>(),
  );
}

function hasCleanup(proxy: OwnedProxy): proxy is RuntimeCleanup {
  return isFunction(proxy.cleanup);
}

function releaseProxy(proxy: OwnedProxy): void {
  if (hasCleanup(proxy)) {
    proxy.cleanup();
    return;
  }
  proxy.detach();
}

function forgetProxy(owner: string, proxy: OwnedProxy): void {
  OWNERSHIP_MAPS.forEach((select) => {
    select(internal).get(owner)?.delete(proxy);
  });
}

export function captureOwnedProxies(attach: () => void): () => void {
  const owner = getModuleContext()?.owner;
  if (!owner) {
    attach();
    return () => {};
  }

  const before = getOwnedProxies(owner).map((proxies) => new Set(proxies));
  attach();
  const attached = getOwnedProxies(owner).flatMap((proxies, index) =>
    [...proxies].filter((proxy) => !before[index].has(proxy)),
  );

  return () => {
    const errors: unknown[] = [];
    attached.forEach((proxy) => {
      try {
        releaseProxy(proxy);
      } catch (error) {
        errors.push(error);
      }
      forgetProxy(owner, proxy);
    });
    attached.length = 0;
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to release host registrations");
    }
  };
}

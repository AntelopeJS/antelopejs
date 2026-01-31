import { AsyncProxy, RegisteringProxy, internal } from '../interfaces/core/beta';

export class ProxyTracker {
  addAsyncProxy(moduleId: string, proxy: AsyncProxy): void {
    internal.addAsyncProxy(moduleId, proxy);
  }

  addRegisteringProxy(moduleId: string, proxy: RegisteringProxy): void {
    internal.addRegisteringProxy(moduleId, proxy);
  }

  clearModule(moduleId: string): void {
    internal.knownAsync.delete(moduleId);
    internal.knownRegisters.delete(moduleId);
  }
}

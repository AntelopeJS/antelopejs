import type { ConfigVars } from "@antelopejs/interface-core/config";
import { Events } from "@antelopejs/interface-core/modules";

import { type ModuleCallbacks, ModuleState } from "../../types";
import {
  ModuleDiagnostics,
  type ModuleDiagnosticsContext,
  moduleDiagnosticsContext,
} from "./diagnostics";

export class ModuleLifecycle {
  private callbacks?: ModuleCallbacks;
  private _state: ModuleState = ModuleState.Loaded;
  private transition: Promise<unknown> = Promise.resolve();

  constructor(
    private moduleId: string,
    private moduleVersion: string | undefined,
  ) {}

  get state(): ModuleState {
    return this._state;
  }

  setCallbacks(callbacks: ModuleCallbacks): void {
    this.callbacks = callbacks;
  }

  setVersion(version: string | undefined): void {
    this.moduleVersion = version;
  }

  /**
   * Runs the module's `provide` callback, before any module constructs.
   *
   * The state stays `Loaded`: publishing config variables is not a lifecycle
   * transition, it only feeds the configuration of the modules that reference
   * them.
   */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- ModuleLifecycle is emitted in the published declarations through Module.state, so provide keeps its unknown application config parameter.
  provide(config: unknown): Promise<ConfigVars | void> {
    return this.enqueue(async () => {
      if (this._state !== ModuleState.Loaded) {
        return undefined;
      }

      return this.callbacks?.provide?.(config) ?? undefined;
    });
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- ModuleLifecycle is emitted in the published declarations through Module.state, so construct keeps its unknown application config parameter.
  construct(config: unknown): Promise<void> {
    return this.enqueue(() => {
      if (this._state !== ModuleState.Loaded) {
        return Promise.resolve();
      }

      return ModuleDiagnostics.construct.tracePromise(async () => {
        this._state = ModuleState.Constructed;
        await this.callbacks?.construct?.(config);

        Events.ModuleConstructed.emit(this.moduleId);
      }, this.diagnosticsContext());
    });
  }

  start(): Promise<void> {
    return this.enqueue(() => this.runStart());
  }

  private runStart(): Promise<void> {
    if (this._state !== ModuleState.Constructed) {
      return Promise.resolve();
    }

    return ModuleDiagnostics.start.tracePromise(
      () => this.applyStart(),
      this.diagnosticsContext(),
    );
  }

  private async applyStart(): Promise<void> {
    await this.callbacks?.start?.();
    Events.ModuleStarted.emit(this.moduleId);
    this._state = ModuleState.Active;
  }

  stop(): Promise<void> {
    return this.enqueue(() => this.runStop());
  }

  private runStop(): Promise<void> {
    if (this._state !== ModuleState.Active) {
      return Promise.resolve();
    }

    return ModuleDiagnostics.stop.tracePromise(
      () => this.applyStop(),
      this.diagnosticsContext(),
    );
  }

  private async applyStop(): Promise<void> {
    if (this.callbacks?.stop) {
      await this.callbacks.stop();
    }
    Events.ModuleStopped.emit(this.moduleId);
    this._state = ModuleState.Constructed;
  }

  destroy(): Promise<void> {
    return this.enqueue(() => this.runDestroy());
  }

  private runDestroy(): Promise<void> {
    if (this._state === ModuleState.Loaded) {
      return Promise.resolve();
    }

    return ModuleDiagnostics.destroy.tracePromise(
      () => this.applyDestroy(),
      this.diagnosticsContext(),
    );
  }

  private async applyDestroy(): Promise<void> {
    const errors: unknown[] = [];
    let destroyFailed = false;
    if (this._state === ModuleState.Active) {
      try {
        await this.runStop();
      } catch (error) {
        errors.push(error);
      }
    }

    try {
      await this.callbacks?.destroy?.();
    } catch (error) {
      errors.push(error);
      destroyFailed = true;
    }

    if (!destroyFailed) {
      Events.ModuleDestroyed.emit(this.moduleId);
      this._state = ModuleState.Loaded;
    }
    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(
        errors,
        `Failed to destroy module ${this.moduleId}`,
      );
    }
  }

  private diagnosticsContext(): ModuleDiagnosticsContext {
    return moduleDiagnosticsContext(this.moduleId, this.moduleVersion);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.transition.then(operation, operation);
    this.transition = result.catch(() => undefined);
    return result;
  }
}

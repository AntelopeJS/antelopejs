import { Events } from "@antelopejs/interface-core/modules";

import { type ModuleCallbacks, ModuleState } from "../types";
import {
  ModuleDiagnostics,
  type ModuleDiagnosticsContext,
  moduleDiagnosticsContext,
} from "./diagnostics";

export class ModuleLifecycle {
  private callbacks?: ModuleCallbacks;
  private _state: ModuleState = ModuleState.Loaded;
  private transition: Promise<void> = Promise.resolve();

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

  construct(config: unknown): Promise<void> {
    return this.enqueue(() => this.runConstruct(config));
  }

  private runConstruct(config: unknown): Promise<void> {
    if (this._state !== ModuleState.Loaded) {
      return Promise.resolve();
    }

    return ModuleDiagnostics.construct.tracePromise(
      () => this.applyConstruct(config),
      this.diagnosticsContext(),
    );
  }

  private async applyConstruct(config: unknown): Promise<void> {
    this._state = ModuleState.Constructed;
    if (this.callbacks?.construct) {
      await this.callbacks.construct(config);
    }

    Events.ModuleConstructed.emit(this.moduleId);
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

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.transition.then(operation, operation);
    this.transition = result.catch(() => undefined);
    return result;
  }
}

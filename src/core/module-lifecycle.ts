import { ModuleCallbacks, ModuleState } from '../types';
import { Events } from '../interfaces/core/beta/modules';

export class ModuleLifecycle {
  private callbacks?: ModuleCallbacks;
  private _state: ModuleState = ModuleState.Loaded;

  constructor(private moduleId: string) {}

  get state(): ModuleState {
    return this._state;
  }

  setCallbacks(callbacks: ModuleCallbacks): void {
    this.callbacks = callbacks;
  }

  async construct(config: unknown): Promise<void> {
    if (this._state !== ModuleState.Loaded) {
      return;
    }

    if (this.callbacks?.construct) {
      await this.callbacks.construct(config);
    }

    Events.ModuleConstructed.emit(this.moduleId);
    this._state = ModuleState.Constructed;
  }

  start(): void {
    if (this._state !== ModuleState.Constructed) {
      return;
    }

    this.callbacks?.start?.();
    Events.ModuleStarted.emit(this.moduleId);
    this._state = ModuleState.Active;
  }

  stop(): void {
    if (this._state !== ModuleState.Active) {
      return;
    }

    this.callbacks?.stop?.();
    Events.ModuleStopped.emit(this.moduleId);
    this._state = ModuleState.Constructed;
  }

  async destroy(): Promise<void> {
    if (this._state === ModuleState.Loaded) {
      return;
    }

    if (this._state === ModuleState.Active) {
      this.stop();
    }

    if (this.callbacks?.destroy) {
      await this.callbacks.destroy();
    }

    Events.ModuleDestroyed.emit(this.moduleId);
    this._state = ModuleState.Loaded;
  }
}

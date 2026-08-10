import { Events } from "@antelopejs/interface-core/modules";
import { type ModuleCallbacks, ModuleState } from "../types";

export class ModuleLifecycle {
  private callbacks?: ModuleCallbacks;
  private _state: ModuleState = ModuleState.Loaded;
  private starting?: Promise<void>;

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

  async start(): Promise<void> {
    if (this.starting) {
      return this.starting;
    }

    if (this._state !== ModuleState.Constructed) {
      return;
    }

    this.starting = this.runStart();
    return this.starting;
  }

  private async runStart(): Promise<void> {
    try {
      await this.callbacks?.start?.();
      Events.ModuleStarted.emit(this.moduleId);
      this._state = ModuleState.Active;
    } finally {
      this.starting = undefined;
    }
  }

  /**
   * An async start hook leaves the state on `Constructed` until it settles, so
   * guards below must wait for it instead of reading a state that is still in
   * transition - otherwise a stop racing a pending start silently no-ops and
   * the module ends up active anyway.
   */
  private async settleStart(): Promise<void> {
    if (this.starting) {
      await this.starting.catch(() => undefined);
    }
  }

  async stop(): Promise<void> {
    await this.settleStart();

    if (this._state !== ModuleState.Active) {
      return;
    }

    if (this.callbacks?.stop) {
      await this.callbacks.stop();
    }
    Events.ModuleStopped.emit(this.moduleId);
    this._state = ModuleState.Constructed;
  }

  async destroy(): Promise<void> {
    await this.settleStart();

    if (this._state === ModuleState.Loaded) {
      return;
    }

    if (this._state === ModuleState.Active) {
      await this.stop();
    }

    if (this.callbacks?.destroy) {
      await this.callbacks.destroy();
    }

    Events.ModuleDestroyed.emit(this.moduleId);
    this._state = ModuleState.Loaded;
  }
}

import { runAsCapturedCaller } from "@antelopejs/interface-core/internal";
import { Logging } from "@antelopejs/interface-core/logging";
import { Events } from "@antelopejs/interface-core/modules";

const Logger = new Logging.Channel("loader.hot-reload");

/** Runs the reloads and the restart the holds deferred, once the last hold ends. */
export type HeldReloadsRunner = () => Promise<void>;

/**
 * The open holds on the watcher's reloads, each keyed by its id and naming the
 * module that took it. Holds only hold while a watcher runs.
 */
export class ReloadHolds {
  private readonly holders = new Map<string, string | undefined>();
  private nextHoldId = 0;
  private runHeld?: HeldReloadsRunner;

  /** Whether a watcher runs and at least one hold is open. */
  get held(): boolean {
    return this.runHeld !== undefined && this.holders.size > 0;
  }

  /** Opens a hold for `module`, the module whose generation takes it. */
  take(module: string | undefined): string {
    this.nextHoldId += 1;
    const id = String(this.nextHoldId);
    this.holders.set(id, module);
    return id;
  }

  /**
   * Ends a hold. Ending the last one resolves once the watcher ran what the
   * holds deferred, outside the context of the module that ended it, which a
   * restart or its own destruction invalidates. An unknown or ended id
   * resolves at once.
   */
  async release(id: string): Promise<void> {
    if (!this.holders.delete(id) || this.holders.size > 0) {
      return;
    }
    const runHeld = this.runHeld;
    if (runHeld) {
      await runAsCapturedCaller(undefined, runHeld);
    }
  }

  /** Ends every hold `module` took. */
  async releaseModule(module: string): Promise<void> {
    const ids = [...this.holders]
      .filter(([, holder]) => holder === module)
      .map(([id]) => id);
    await Promise.all(ids.map((id) => this.release(id)));
  }

  /**
   * Makes the holds hold until the returned function is called, running
   * `runHeld` when the last one ends.
   */
  watch(runHeld: HeldReloadsRunner): () => void {
    this.runHeld = runHeld;
    return () => {
      if (this.runHeld === runHeld) {
        this.runHeld = undefined;
      }
    };
  }
}

/** The holds `HoldReloads` and `ReleaseReloads` open and end. */
export const reloadHolds = new ReloadHolds();

Events.ModuleDestroyed.register((module) => {
  reloadHolds.releaseModule(module).catch((error: unknown) => {
    Logger.Error(`Failed to run the reloads ${module} held:`, error);
  });
});

import { Logging } from "@antelopejs/interface-core/logging";

export type ReloadHandler = (moduleId: string) => void | Promise<void>;

const DEFAULT_DEBOUNCE_MS = 500;
const Logger = new Logging.Channel("loader.hot-reload");

/**
 * Reloads the modules whose files changed, once per debounce window. While
 * `isHeld` answers true, changes only queue: {@link HotReload.settle} reloads
 * them once the hold ends.
 */
export class HotReload {
  private pending = new Set<string>();
  private inFlight = new Set<string>();
  private rePending = new Set<string>();
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(
    private reload: ReloadHandler,
    private isHeld: () => boolean = () => false,
    private debounceMs: number = DEFAULT_DEBOUNCE_MS,
  ) {}

  queue(moduleId: string): void {
    if (this.inFlight.has(moduleId)) {
      this.rePending.add(moduleId);
      return;
    }
    this.pending.add(moduleId);
    if (!this.isHeld()) {
      this.scheduleFlush();
    }
  }

  /**
   * Reloads what is queued, and resolves once nothing is reloading and
   * nothing queued is free to reload.
   */
  async settle(): Promise<void> {
    this.cancelTimer();
    while (this.running || (this.pending.size > 0 && !this.isHeld())) {
      await this.flush();
    }
  }

  clear(): void {
    this.cancelTimer();
    this.pending.clear();
    this.rePending.clear();
  }

  private cancelTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private scheduleFlush(): void {
    if (this.timer || this.running) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.debounceMs);
  }

  private flush(): Promise<void> {
    this.running ??= this.reloadPending().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async reloadPending(): Promise<void> {
    while (this.pending.size > 0 && !this.isHeld()) {
      const modules = Array.from(this.pending);
      this.pending.clear();
      for (const id of modules) {
        await this.reloadOne(id);
      }
      for (const id of this.rePending) {
        this.pending.add(id);
      }
      this.rePending.clear();
    }
  }

  private async reloadOne(moduleId: string): Promise<void> {
    this.inFlight.add(moduleId);
    try {
      await this.reload(moduleId);
    } catch (err) {
      Logger.Error(`Failed to reload module ${moduleId}:`, err);
    } finally {
      this.inFlight.delete(moduleId);
    }
  }
}

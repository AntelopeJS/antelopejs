import { Logging } from "@antelopejs/interface-core/logging";

export type ReloadHandler = (moduleId: string) => void | Promise<void>;

const DEFAULT_DEBOUNCE_MS = 500;
const Logger = new Logging.Channel("loader.hot-reload");

export class HotReload {
  private pending = new Set<string>();
  private inFlight = new Set<string>();
  private rePending = new Set<string>();
  private timer?: NodeJS.Timeout;
  private flushing = false;

  constructor(
    private reload: ReloadHandler,
    private debounceMs: number = DEFAULT_DEBOUNCE_MS,
  ) {}

  queue(moduleId: string): void {
    if (this.inFlight.has(moduleId)) {
      this.rePending.add(moduleId);
      return;
    }
    this.pending.add(moduleId);
    this.scheduleFlush();
  }

  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.pending.clear();
    this.rePending.clear();
  }

  private scheduleFlush(): void {
    if (this.timer || this.flushing) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.debounceMs);
  }

  private async flush(): Promise<void> {
    if (this.flushing) {
      return;
    }
    this.flushing = true;
    try {
      while (this.pending.size > 0) {
        const modules = Array.from(this.pending);
        this.pending.clear();
        for (const id of modules) {
          await this.reloadOne(id);
        }
        if (this.rePending.size > 0) {
          for (const id of this.rePending) {
            this.pending.add(id);
          }
          this.rePending.clear();
        }
      }
    } finally {
      this.flushing = false;
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

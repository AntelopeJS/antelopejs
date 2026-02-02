export type ReloadHandler = (moduleId: string) => void | Promise<void>;

export class HotReload {
  private pending = new Set<string>();
  private timer?: NodeJS.Timeout;

  constructor(
    private reload: ReloadHandler,
    private debounceMs: number = 500,
  ) {}

  queue(moduleId: string): void {
    this.pending.add(moduleId);
    if (!this.timer) {
      this.timer = setTimeout(async () => {
        const modules = Array.from(this.pending);
        this.pending.clear();
        this.timer = undefined;
        for (const id of modules) {
          await this.reload(id);
        }
      }, this.debounceMs);
    }
  }
}

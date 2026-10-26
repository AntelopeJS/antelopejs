import type { Ui } from "./types";

export interface DataOutput {
  data: unknown;
  isJson?: boolean;
  render(ui: Ui): void;
}

/**
 * Writes what a data command produced: `data` as one JSON document on stdout
 * with `--json`, its human rendering otherwise.
 */
export function writeData(ui: Ui, output: DataOutput): void {
  if (output.isJson) {
    ui.json(output.data);
    return;
  }
  output.render(ui);
}

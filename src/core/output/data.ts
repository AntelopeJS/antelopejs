import type { JsonValue, Ui } from "./types";

/** What a data command produced. `data` is what `--json` prints. */
export interface DataOutput<Data> {
  data: Data & JsonValue<Data>;
  isJson?: boolean;
  render(ui: Ui): void;
}

/**
 * Writes what a data command produced: `data` as one JSON document on stdout
 * with `--json`, its human rendering otherwise.
 */
export function writeData<Data>(ui: Ui, output: DataOutput<Data>): void {
  if (output.isJson) {
    ui.json(output.data);
    return;
  }
  output.render(ui);
}

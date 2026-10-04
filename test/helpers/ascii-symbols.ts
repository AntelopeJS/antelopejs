import sinon from "sinon";

import { getProcessUi, SYMBOL_SETS } from "../../src/core/cli/output";

/**
 * Draws the process output with the ASCII symbol set until `sinon.restore()`,
 * as on a dumb terminal, a non-UTF-8 locale or the legacy Windows console.
 */
export function useAsciiSymbols(): void {
  sinon.stub(getProcessUi(), "symbols").value(SYMBOL_SETS.ascii);
}

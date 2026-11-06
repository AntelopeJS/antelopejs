import type Mocha from "mocha";

import type { TestContext } from "./test-context";

export class TestRunner {
  constructor(
    private context: TestContext,
    private mochaFactory?: () => Mocha,
  ) {}

  async run(files: string[]): Promise<number> {
    await this.context.setup();

    try {
      const mocha = this.mochaFactory
        ? this.mochaFactory()
        : new (await import("mocha")).default();
      for (const file of files) {
        mocha.addFile(file);
      }

      const failures = await new Promise<number>((resolve) => {
        mocha.run((count) => resolve(count));
      });

      return failures;
    } finally {
      await this.context.cleanup();
    }
  }
}

import Mocha from 'mocha';
import { TestContext } from './test-context';

export class TestRunner {
  constructor(
    private context: TestContext,
    private mochaFactory: () => Mocha = () => new Mocha()
  ) {}

  async run(files: string[]): Promise<number> {
    await this.context.setup();

    try {
      const mocha = this.mochaFactory();
      files.forEach((file) => mocha.addFile(file));

      const failures = await new Promise<number>((resolve) => {
        mocha.run((count) => resolve(count));
      });

      return failures;
    } finally {
      await this.context.cleanup();
    }
  }
}

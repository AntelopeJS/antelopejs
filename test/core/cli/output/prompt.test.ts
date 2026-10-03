import sinon from "sinon";
import { expect } from "chai";

import {
  CancelledError,
  createPrompter,
  missingFlags,
  NeedsInputError,
  promptEnvironment,
} from "../../../../src/core/cli/output";
import { USAGE_EXIT_CODE } from "../../../../src/core/cli/exit-codes";
import { CANCEL, fakePrompts } from "../../../helpers/fake-prompts";

const COMMAND = "ajs project init demo";

interface InitFlags {
  name?: string;
  template?: string;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject");
}

describe("createPrompter", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("takes the answer given on the command line without asking", async () => {
    const prompts = fakePrompts({ isInteractive: false });
    const prompter = createPrompter({ command: COMMAND });

    const name = await prompter.text({
      message: "Project name",
      flag: "--name <name>",
      answer: "shop",
    });

    expect(name).to.equal("shop");
    expect(prompts.asked).to.deep.equal([]);
  });

  it("answers with the default when defaults are accepted", async () => {
    const prompts = fakePrompts({ isInteractive: true });
    const prompter = createPrompter({ command: COMMAND, acceptsDefaults: true });

    const isGitInitialized = await prompter.confirm({
      message: "Initialize git?",
      flag: "--git",
      defaultAnswer: true,
    });

    expect(isGitInitialized).to.equal(true);
    expect(prompts.asked).to.deep.equal([]);
  });

  it("asks when the session is interactive", async () => {
    const prompts = fakePrompts({ answers: ["pnpm"] });
    const prompter = createPrompter({ command: COMMAND });

    const packageManager = await prompter.select({
      message: "Package manager",
      flag: "--pm <name>",
      choices: [
        { value: "npm", label: "npm" },
        { value: "pnpm", label: "pnpm", hint: "fast" },
      ],
      defaultAnswer: "npm",
    });

    expect(packageManager).to.equal("pnpm");
    expect(prompter.isInteractive).to.equal(true);
    expect(prompts.asked[0].kind).to.equal("select");
    expect(prompts.asked[0].options).to.include({ initialValue: "npm" });
    expect(prompts.asked[0].options.options).to.deep.equal([
      { value: "npm", label: "npm", hint: undefined },
      { value: "pnpm", label: "pnpm", hint: "fast" },
    ]);
  });

  it("draws prompts on the prompt output stream", async () => {
    const prompts = fakePrompts({ answers: ["shop", true, ["api"]] });
    const prompter = createPrompter({ command: COMMAND });

    await prompter.text({
      message: "Project name",
      flag: "--name <name>",
      defaultAnswer: "demo",
    });
    await prompter.confirm({ message: "Initialize git?", flag: "--git" });
    const interfaces = await prompter.multiselect({
      message: "Interfaces",
      flag: "--interfaces <names>",
      choices: [{ value: "api", label: "api" }],
      defaultAnswer: [],
    });

    expect(interfaces).to.deep.equal(["api"]);
    expect(prompts.asked.map((prompt) => prompt.kind)).to.deep.equal([
      "text",
      "confirm",
      "multiselect",
    ]);
    expect(prompts.asked[0].options).to.include({
      placeholder: "demo",
      defaultValue: "demo",
      output: process.stderr,
    });
    expect(prompts.asked[2].options).to.include({ required: false });
  });

  it("fails with NeedsInputError naming the flag when it cannot ask", async () => {
    const prompts = fakePrompts({ isInteractive: false });
    const prompter = createPrompter({
      command: COMMAND,
      defaultsFlag: "--yes",
    });

    const error = await rejectionOf(
      prompter.text({ message: "Project name", flag: "--name <name>" }),
    );

    expect(error).to.be.instanceOf(NeedsInputError);
    const needsInput = error as NeedsInputError;
    expect(needsInput.exitCode).to.equal(USAGE_EXIT_CODE);
    expect(needsInput.problem.fixes).to.deep.equal([
      "Pass it as a flag: ajs project init demo --name <name>",
      "Or accept the defaults: ajs project init demo --yes",
    ]);
    expect(prompts.asked).to.deep.equal([]);
  });

  it("does not offer defaults on a question without one", async () => {
    fakePrompts({ isInteractive: false });
    const prompter = createPrompter({
      command: COMMAND,
      acceptsDefaults: true,
    });

    const error = await rejectionOf(
      prompter.text({ message: "Project name", flag: "--name <name>" }),
    );

    expect(error).to.be.instanceOf(NeedsInputError);
  });

  it("answers an optional question with its default when it cannot ask", async () => {
    fakePrompts({ isInteractive: false });
    const prompter = createPrompter({ command: COMMAND });

    const interfaces = await prompter.multiselect({
      message: "Interfaces",
      flag: "--interfaces <names>",
      choices: [{ value: "api", label: "api" }],
      defaultAnswer: [],
      isOptional: true,
    });

    expect(interfaces).to.deep.equal([]);
  });

  it("throws CancelledError when the prompt is cancelled", async () => {
    fakePrompts({ answers: [CANCEL] });
    const prompter = createPrompter({ command: COMMAND });

    const error = await rejectionOf(
      prompter.confirm({ message: "Continue?", flag: "--yes" }),
    );

    expect(error).to.be.instanceOf(CancelledError);
    expect((error as Error).message).to.equal("Cancelled");
  });

  describe("requireAnswers", () => {
    it("names every missing flag at once when it cannot ask", () => {
      fakePrompts({ isInteractive: false });
      const prompter = createPrompter({ command: COMMAND });

      expect(() =>
        prompter.requireAnswers(["--name <name>", "--pm <name>"]),
      ).to.throw(NeedsInputError);
      try {
        prompter.requireAnswers(["--name <name>", "--pm <name>"]);
      } catch (error) {
        expect((error as NeedsInputError).problem.fixes).to.deep.equal([
          "Pass them as flags: ajs project init demo --name <name> --pm <name>",
        ]);
      }
    });

    it("accepts a run that can ask or takes the defaults", () => {
      fakePrompts({ isInteractive: true });
      expect(() =>
        createPrompter({ command: COMMAND }).requireAnswers(["--name <name>"]),
      ).not.to.throw();

      sinon.restore();
      fakePrompts({ isInteractive: false });
      const withDefaults = createPrompter({
        command: COMMAND,
        acceptsDefaults: true,
      });
      expect(() => withDefaults.requireAnswers(["--name <name>"])).not.to.throw();
    });

    it("accepts a run that gave every answer", () => {
      fakePrompts({ isInteractive: false });

      expect(() =>
        createPrompter({ command: COMMAND }).requireAnswers([]),
      ).not.to.throw();
    });
  });
});

describe("missingFlags", () => {
  it("lists the flags of the options left undefined", () => {
    const flags = missingFlags<InitFlags>({ name: "shop" }, [
      { option: "name", flag: "--name <name>" },
      { option: "template", flag: "--template <name>" },
    ]);

    expect(flags).to.deep.equal(["--template <name>"]);
  });
});

describe("promptEnvironment", () => {
  it("loads the prompt library on demand", async () => {
    const backend = await promptEnvironment.loadBackend();

    expect(backend.text).to.be.a("function");
    expect(backend.isCancel(Symbol("other"))).to.equal(false);
  });

  it("draws prompts on stderr", () => {
    expect(promptEnvironment.output()).to.equal(process.stderr);
  });

  it("detects the session from the process streams", () => {
    expect(promptEnvironment.isInteractive()).to.be.a("boolean");
  });
});

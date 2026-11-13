declare module "inly" {
  interface InlyExtraction {
    on(event: "error", listener: (error: Error) => void): void;
    on(event: "end", listener: () => void): void;
  }

  function inly(from: string, to: string): InlyExtraction;

  export = inly;
}

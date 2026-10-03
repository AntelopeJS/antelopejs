import * as sinon from "sinon";

export interface CapturedOutput {
  stdout: string;
  stderr: string;
}

type StreamWrite = typeof process.stdout.write;

function collectInto(sink: string[]): StreamWrite {
  return ((chunk: unknown): boolean => {
    sink.push(String(chunk));
    return true;
  }) as unknown as StreamWrite;
}

export function captureOutput(emit: () => void): CapturedOutput {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const stdoutStub = sinon
    .stub(process.stdout, "write")
    .callsFake(collectInto(stdout));
  const stderrStub = sinon
    .stub(process.stderr, "write")
    .callsFake(collectInto(stderr));

  try {
    emit();
  } finally {
    stdoutStub.restore();
    stderrStub.restore();
  }

  return { stdout: stdout.join(""), stderr: stderr.join("") };
}

import * as sinon from "sinon";
import { stripAnsi } from "../../src/core/cli/logging-utils";

export interface CapturedOutput {
  stdout: string;
  stderr: string;
}

type StreamWrite = typeof process.stdout.write;

interface StreamCapture {
  stdout: string[];
  stderr: string[];
  restore(): void;
}

function collectInto(sink: string[]): StreamWrite {
  return ((chunk: unknown): boolean => {
    sink.push(String(chunk));
    return true;
  }) as unknown as StreamWrite;
}

function startCapture(): StreamCapture {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const stdoutStub = sinon
    .stub(process.stdout, "write")
    .callsFake(collectInto(stdout));
  const stderrStub = sinon
    .stub(process.stderr, "write")
    .callsFake(collectInto(stderr));
  return {
    stdout,
    stderr,
    restore: () => {
      stdoutStub.restore();
      stderrStub.restore();
    },
  };
}

function collected(capture: StreamCapture): CapturedOutput {
  return { stdout: capture.stdout.join(""), stderr: capture.stderr.join("") };
}

export function captureOutput(emit: () => void): CapturedOutput {
  const capture = startCapture();
  try {
    emit();
  } finally {
    capture.restore();
  }
  return collected(capture);
}

export async function captureOutputAsync(
  emit: () => Promise<unknown>,
): Promise<CapturedOutput> {
  const capture = startCapture();
  try {
    await emit();
  } finally {
    capture.restore();
  }
  return collected(capture);
}

/**
 * Collects everything written to stderr until `sinon.restore()`, and returns
 * a reader for the text written so far, without ANSI sequences.
 */
export function collectStderr(): () => string {
  const chunks: string[] = [];
  sinon.stub(process.stderr, "write").callsFake(collectInto(chunks));
  return () => stripAnsi(chunks.join(""));
}

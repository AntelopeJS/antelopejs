import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const BLOCK = 512;
const FILE_MODE = 0o644;
const NAME_BYTES = 100;

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function header(name: string, size: number): Buffer {
  if (Buffer.byteLength(name) > NAME_BYTES) {
    throw new Error(`Tar entry name over ${NAME_BYTES} bytes: ${name}`);
  }
  const block = Buffer.alloc(BLOCK);
  block.write(name, 0, NAME_BYTES, "utf8");
  block.write(octal(FILE_MODE, 8), 100, "ascii");
  block.write(octal(0, 8), 108, "ascii");
  block.write(octal(0, 8), 116, "ascii");
  block.write(octal(size, 12), 124, "ascii");
  block.write(octal(0, 12), 136, "ascii");
  block.write(" ".repeat(8), 148, "ascii");
  block.write("0", 156, "ascii");
  block.write("ustar\0", 257, "ascii");
  block.write("00", 263, "ascii");
  const checksum = block.reduce((sum, byte) => sum + byte, 0);
  block.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return block;
}

/**
 * Writes `files` as a gzipped tar archive at `target`, the layout `npm pack`
 * produces when every name starts with `package/`, without spawning npm.
 */
export function writeTarball(
  target: string,
  files: Record<string, string>,
): void {
  const blocks = Object.entries(files).flatMap(([name, content]) => {
    const data = Buffer.from(content);
    const padding = Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK);
    return [header(name, data.length), data, padding];
  });
  writeFileSync(
    target,
    gzipSync(Buffer.concat([...blocks, Buffer.alloc(BLOCK * 2)])),
  );
}

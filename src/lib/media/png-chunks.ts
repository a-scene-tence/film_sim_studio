import { ascii, concat, matches, u32be } from "./binary";

export interface PngChunk { type: string; start: number; dataStart: number; dataEnd: number; end: number }
const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function parsePngChunks(b: Uint8Array): PngChunk[] {
  const out: PngChunk[] = [];
  if (!matches(b, 0, SIG)) return out;
  let p = 8;
  while (p + 12 <= b.length) {
    const len = u32be(b, p);
    const type = ascii(b, p + 4, 4);
    const end = p + 12 + len;
    if (end > b.length) break;
    out.push({ type, start: p, dataStart: p + 8, dataEnd: p + 8 + len, end });
    p = end;
    if (type === "IEND") break;
  }
  return out;
}

export function pngHeader(b: Uint8Array): { width: number; height: number; bitDepth: number; colorType: number } | null {
  const c = parsePngChunks(b)[0];
  if (!c || c.type !== "IHDR") return null;
  return { width: u32be(b, c.dataStart), height: u32be(b, c.dataStart + 4), bitDepth: b[c.dataStart + 8]!, colorType: b[c.dataStart + 9]! };
}

export function stripPngChunks(b: Uint8Array, pred: (c: PngChunk, b: Uint8Array) => boolean): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  for (const c of parsePngChunks(b)) if (!pred(c, b)) parts.push(b.subarray(c.start, c.end));
  return concat(parts);
}

/** iTXt 키워드 */
export function itxtKeyword(b: Uint8Array, c: PngChunk): string {
  let e = c.dataStart;
  while (e < c.dataEnd && b[e] !== 0) e++;
  return ascii(b, c.dataStart, e - c.dataStart);
}

export const isExifChunk = (c: PngChunk) => c.type === "eXIf";
export const isXmpChunk = (c: PngChunk, b: Uint8Array) => c.type === "iTXt" && itxtKeyword(b, c) === "XML:com.adobe.xmp";

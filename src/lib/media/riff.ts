import { ascii, concat, u16le, u32le } from "./binary";

export interface RiffChunk { id: string; start: number; dataStart: number; size: number; end: number }

export function parseRiff(b: Uint8Array): RiffChunk[] {
  const out: RiffChunk[] = [];
  let p = 12;
  while (p + 8 <= b.length) {
    const size = u32le(b, p + 4);
    const dataStart = p + 8;
    const end = Math.min(b.length, dataStart + size + (size & 1));
    out.push({ id: ascii(b, p, 4), start: p, dataStart, size, end });
    p = dataStart + size + (size & 1);
  }
  return out;
}

/** 8.4 EXIF 청크를 제거한 RIFF 를 다시 만든다. VP8X 의 EXIF 비트(0x08)를 끈다. */
export function stripWebpExif(b: Uint8Array): Uint8Array {
  const chunks = parseRiff(b).filter((c) => c.id !== "EXIF");
  const body: Uint8Array[] = [];
  let total = 4;
  for (const c of chunks) {
    const data = b.slice(c.dataStart, c.dataStart + c.size);
    if (c.id === "VP8X" && data.length > 0) data[0] = data[0]! & ~0x08;
    const pad = c.size & 1;
    const head = new Uint8Array(8);
    head.set(b.subarray(c.start, c.start + 4), 0);
    new DataView(head.buffer).setUint32(4, c.size, true);
    body.push(head, data, new Uint8Array(pad));
    total += 8 + c.size + pad;
  }
  const head = new Uint8Array(12);
  head.set(b.subarray(0, 4), 0);
  new DataView(head.buffer).setUint32(4, total, true);
  head.set(b.subarray(8, 12), 8);
  return concat([head, ...body]);
}

/** WebP 캔버스 크기 (VP8X / VP8 / VP8L) */
export function webpSize(b: Uint8Array): { width: number; height: number } | null {
  for (const c of parseRiff(b)) {
    const d = c.dataStart;
    if (c.id === "VP8X") return { width: 1 + (b[d + 4]! | (b[d + 5]! << 8) | (b[d + 6]! << 16)), height: 1 + (b[d + 7]! | (b[d + 8]! << 8) | (b[d + 9]! << 16)) };
    if (c.id === "VP8 ") return { width: u16le(b, d + 6) & 0x3fff, height: u16le(b, d + 8) & 0x3fff };
    if (c.id === "VP8L") { const v = u32le(b, d + 1); return { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 }; }
  }
  return null;
}

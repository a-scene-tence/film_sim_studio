import { ascii, u32be, u64be } from "./binary";

export interface Box { type: string; start: number; headerSize: number; end: number; payloadStart: number }

/** [start,end) 범위의 박스 목록. size=1 이면 u64, size=0 이면 end 까지. */
export function readBoxes(b: Uint8Array, start: number, end: number): Box[] {
  const out: Box[] = [];
  let p = start;
  end = Math.min(end, b.length);
  while (p + 8 <= end) {
    let size = u32be(b, p);
    const type = ascii(b, p + 4, 4);
    let hs = 8;
    if (size === 1) { if (p + 16 > end) break; size = u64be(b, p + 8); hs = 16; }
    else if (size === 0) size = end - p;
    if (size < hs) break;
    const e = Math.min(end, p + size);
    out.push({ type, start: p, headerSize: hs, end: e, payloadStart: p + hs });
    p += size;
  }
  return out;
}

export function children(b: Uint8Array, box: Box, skip = 0): Box[] {
  return readBoxes(b, box.payloadStart + skip, box.end);
}

export function find(boxes: Box[], type: string): Box | undefined {
  return boxes.find((x) => x.type === type);
}

/** meta 박스 자식 시작 오프셋: QuickTime(payload[4..8)="hdlr") 은 그대로, ISO FullBox(payload[8..12)="hdlr") 는 4바이트 건너뜀 */
export function metaChildrenOffset(b: Uint8Array, box: Box): number {
  if (ascii(b, box.payloadStart + 4, 4) === "hdlr") return 0;
  if (ascii(b, box.payloadStart + 8, 4) === "hdlr") return 4;
  return 4;
}

export function payload(b: Uint8Array, box: Box): Uint8Array {
  return b.subarray(box.payloadStart, box.end);
}

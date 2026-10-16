import { u16be, u16le, u32be, u32le } from "./binary";

export interface RawEntry {
  tag: number;
  type: number;
  count: number;
  /** 원본 바이트순서 그대로의 값 바이트 */
  bytes: Uint8Array;
  littleEndian: boolean;
  /** 항목의 값/오프셋 필드(4바이트)의 TIFF 내 위치 */
  valueOffsetPos: number;
}
export type IfdMap = Map<number, RawEntry>;
export interface TiffGroups { littleEndian: boolean; ifd0: IfdMap; exif: IfdMap; gps: IfdMap; interop: IfdMap; ifd1: IfdMap }

export const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };
const MAX_VALUE_BYTES = 16 * 1024 * 1024;

export class TiffReader {
  readonly le: boolean;
  readonly ifd0Offset: number;
  private visited = new Set<number>();
  constructor(readonly b: Uint8Array) {
    const sig = String.fromCharCode(b[0] ?? 0, b[1] ?? 0);
    if ((sig !== "II" && sig !== "MM") || b.length < 8) throw new Error("TIFF 헤더가 아닙니다");
    this.le = sig === "II";
    if (this.u16(2) !== 42) throw new Error("TIFF 매직 42 가 아닙니다");
    this.ifd0Offset = this.u32(4);
  }
  u16(o: number): number { return this.le ? u16le(this.b, o) : u16be(this.b, o); }
  u32(o: number): number { return this.le ? u32le(this.b, o) : u32be(this.b, o); }

  /** IFD 하나를 읽는다. 순환·범위 초과는 빈 결과. */
  readIfd(offset: number): { entries: IfdMap; next: number } {
    const entries: IfdMap = new Map();
    const b = this.b;
    if (offset < 8 || offset + 2 > b.length || this.visited.has(offset)) return { entries, next: 0 };
    this.visited.add(offset);
    const n = this.u16(offset);
    if (n > 1000) return { entries, next: 0 };
    for (let i = 0; i < n; i++) {
      const p = offset + 2 + i * 12;
      if (p + 12 > b.length) return { entries, next: 0 };
      const tag = this.u16(p), type = this.u16(p + 2), count = this.u32(p + 4);
      const size = TYPE_SIZE[type];
      if (!size) continue;
      const total = count * size;
      if (total > MAX_VALUE_BYTES) continue;
      let start = p + 8;
      if (total > 4) {
        start = this.u32(p + 8);
        if (start + total > b.length) continue;
      }
      entries.set(tag, { tag, type, count, bytes: b.slice(start, start + total), littleEndian: this.le, valueOffsetPos: p + 8 });
    }
    const np = offset + 2 + n * 12;
    return { entries, next: np + 4 <= b.length ? this.u32(np) : 0 };
  }

  private sub(parent: IfdMap, tag: number): IfdMap {
    const e = parent.get(tag);
    if (!e || e.bytes.length < 4) return new Map();
    return this.readIfd(readUint(e, 0)).entries;
  }

  groups(): TiffGroups {
    const { entries: ifd0, next } = this.readIfd(this.ifd0Offset);
    const exif = this.sub(ifd0, 0x8769);
    const gps = this.sub(ifd0, 0x8825);
    const interop = this.sub(exif, 0xa005);
    const ifd1 = next ? this.readIfd(next).entries : new Map<number, RawEntry>();
    return { littleEndian: this.le, ifd0, exif, gps, interop, ifd1 };
  }
}

export function readTiff(b: Uint8Array): TiffGroups | null {
  try { return new TiffReader(b).groups(); } catch { return null; }
}

function bv(e: RawEntry): DataView { return new DataView(e.bytes.buffer, e.bytes.byteOffset, e.bytes.byteLength); }

/** 정수형 값 i 번째 (BYTE/SHORT/LONG/IFD, 부호형 포함) */
export function readUint(e: RawEntry, i: number): number {
  const v = bv(e);
  switch (e.type) {
    case 1: case 7: return v.getUint8(i);
    case 6: return v.getInt8(i);
    case 3: return v.getUint16(i * 2, e.littleEndian);
    case 8: return v.getInt16(i * 2, e.littleEndian);
    case 4: case 13: return v.getUint32(i * 4, e.littleEndian);
    case 9: return v.getInt32(i * 4, e.littleEndian);
    default: return 0;
  }
}

/** RATIONAL(5)/SRATIONAL(10) i 번째 → [분자, 분모] (정수 그대로) */
export function readRational(e: RawEntry, i: number): [number, number] {
  const v = bv(e);
  return e.type === 10
    ? [v.getInt32(i * 8, e.littleEndian), v.getInt32(i * 8 + 4, e.littleEndian)]
    : [v.getUint32(i * 8, e.littleEndian), v.getUint32(i * 8 + 4, e.littleEndian)];
}

export function readAscii(e: RawEntry): string {
  let s = "";
  for (let i = 0; i < e.bytes.length; i++) s += String.fromCharCode(e.bytes[i]!);
  return s;
}

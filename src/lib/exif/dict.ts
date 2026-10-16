import { readRational, readUint, type IfdMap, type RawEntry } from "../media/tiff";
import { fromBinStr, toBinStr } from "./binstr";

export type ExifGroup = "0th" | "Exif" | "GPS" | "Interop";
export const GROUPS: ExifGroup[] = ["0th", "Exif", "GPS", "Interop"];
export type PiexifType = "Byte" | "Ascii" | "Short" | "Long" | "Rational" | "SRational" | "Undefined";
export type ExifDict = Record<ExifGroup, Record<number, unknown>>;
export type ExifDictTypes = Record<ExifGroup, Record<number, PiexifType>>;

export const emptyDict = (): ExifDict => ({ "0th": {}, Exif: {}, GPS: {}, Interop: {} });
export const emptyTypes = (): ExifDictTypes => ({ "0th": {}, Exif: {}, GPS: {}, Interop: {} });

const hex = (n: number, w = 4) => n.toString(16).toUpperCase().padStart(w, "0");

/** 13.3 dict 값 변환 (piexif 입력 형식) */
export function entryToPiexif(e: RawEntry, report: string[]): { value: unknown; type: PiexifType } {
  const n = e.count;
  const nums = (): number[] => Array.from({ length: n }, (_, i) => readUint(e, i));
  switch (e.type) {
    case 1: return { value: nums(), type: "Byte" };
    case 2: {
      let s = toBinStr(e.bytes);
      if (s.endsWith("\0")) s = s.slice(0, -1);
      return { value: s, type: "Ascii" };
    }
    case 3: return { value: n === 1 ? readUint(e, 0) : nums(), type: "Short" };
    case 4: case 13: return { value: n === 1 ? readUint(e, 0) : nums(), type: "Long" };
    case 5: case 10: {
      const r = Array.from({ length: n }, (_, i) => readRational(e, i));
      return { value: n === 1 ? r[0] : r, type: e.type === 5 ? "Rational" : "SRational" };
    }
    case 7: return { value: toBinStr(e.bytes), type: "Undefined" };
    default: {
      // 6,8,9,11,12 → UNDEFINED, 빅엔디언 바이트로 재인코딩
      const size = e.type === 6 ? 1 : e.type === 8 ? 2 : e.type === 9 || e.type === 11 ? 4 : 8;
      const out = new Uint8Array(e.bytes.length);
      for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) out[i * size + k] = e.bytes[i * size + (e.littleEndian ? size - 1 - k : k)]!;
      report.push(`태그 0x${hex(e.tag)}: 타입 ${e.type} → UNDEFINED`);
      return { value: toBinStr(out), type: "Undefined" };
    }
  }
}

export const IFD0_WHITELIST = new Set([0x010e, 0x010f, 0x0110, 0x0112, 0x011a, 0x011b, 0x0128, 0x0131, 0x0132, 0x013b, 0x8298, 0x9c9b, 0x9c9c, 0x9c9d, 0x9c9e, 0x9c9f, 0x4746, 0x4749]);

export function addGroup(dict: ExifDict, types: ExifDictTypes, group: ExifGroup, map: IfdMap, report: string[], keep: (tag: number) => boolean): void {
  for (const [tag, e] of map) {
    if (!keep(tag)) continue;
    const { value, type } = entryToPiexif(e, report);
    dict[group][tag] = value;
    types[group][tag] = type;
  }
}

export { fromBinStr };

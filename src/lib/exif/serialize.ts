import piexif from "piexifjs";
import { TiffReader, readTiff } from "../media/tiff";
import { fromBinStr } from "./binstr";
import { GROUPS, type ExifDict, type ExifDictTypes, type PiexifType } from "./dict";

export type ExifPayloadMode = "tiff-bytes" | "tiff-dict";
export interface ExifPayload {
  mode: ExifPayloadMode;
  tiff: Uint8Array | null;
  dict: ExifDict | null;
  /** dict 의 (그룹, 태그)별 원본 타입 (13.4 에서 piexif TAGS 에 동적 등록) */
  dictTypes: ExifDictTypes | null;
  xmp: Uint8Array | null;
  iptcIrb: Uint8Array | null;
  orientation: number;
  report: string[];
}

type TagTable = Record<number, { name: string; type: string }>;
const TAGS = piexif.TAGS as Record<string, TagTable>;
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
/** 13.4 모듈 초기화 시 원본 TAGS 깊은 복사 (0th 는 Image/1st 와 같은 객체이므로 Image 를 보관) */
const ORIGINAL: Record<string, TagTable> = {};
for (const g of ["Image", "Exif", "GPS", "Interop"]) ORIGINAL[g] = clone(TAGS[g]!);

function restoreTags(): void {
  for (const g of Object.keys(ORIGINAL)) {
    const live = TAGS[g]!;
    const orig = ORIGINAL[g]!;
    for (const k of Object.keys(live)) if (!(k in orig)) delete live[Number(k)];
    for (const k of Object.keys(orig)) live[Number(k)] = clone(orig[Number(k)]!);
  }
}
/** 테스트용: 현재 TAGS 가 원본과 같은지 */
export function tagsAreOriginal(): boolean {
  return JSON.stringify(Object.fromEntries(Object.keys(ORIGINAL).map((g) => [g, TAGS[g]]))) === JSON.stringify(ORIGINAL);
}

/** 13.4 dict → "Exif\0\0" + MM(빅엔디언) TIFF 바이너리 문자열 */
export function dumpDict(dict: ExifDict, types: ExifDictTypes): string {
  const d = clone(dict);
  delete d["0th"][0x8769];
  delete d["0th"][0x8825];
  delete d.Exif[0xa005];
  try {
    for (const g of GROUPS) {
      for (const k of Object.keys(d[g])) {
        const tag = Number(k);
        const t: PiexifType = types[g][tag] ?? "Undefined";
        const old = TAGS[g]![tag];
        TAGS[g]![tag] = { name: old?.name ?? "Tag0x" + tag.toString(16).toUpperCase().padStart(4, "0"), type: t };
      }
    }
    return piexif.dump(d as unknown as Record<string, unknown>);
  } finally {
    restoreTags();
  }
}

export function dumpDictToTiff(dict: ExifDict, types: ExifDictTypes): Uint8Array {
  return fromBinStr(dumpDict(dict, types)).subarray(6);
}

/** 13.5 tiff-bytes 저장 보정: Orientation=1, PixelX/Y 를 제자리 기록. 나머지 바이트는 그대로. */
export function patchTiffBytes(tiff: Uint8Array, out: { width: number; height: number }, report: string[]): Uint8Array {
  const copy = new Uint8Array(tiff);
  let g;
  try { g = new TiffReader(copy).groups(); } catch { return copy; }
  const dv = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  const o = g.ifd0.get(0x0112);
  if (o && o.type === 3) dv.setUint16(o.valueOffsetPos, 1, g.littleEndian);
  const put = (tag: number, v: number) => {
    const e = g.exif.get(tag);
    if (!e) return;
    if (e.type === 3) {
      if (v <= 65535) dv.setUint16(e.valueOffsetPos, v, g.littleEndian);
      else report.push(`태그 0x${tag.toString(16).toUpperCase()}: SHORT 범위(65535) 초과로 원본 값 유지`);
    } else if (e.type === 4) dv.setUint32(e.valueOffsetPos, v, g.littleEndian);
  };
  put(0xa002, out.width);
  put(0xa003, out.height);
  return copy;
}

/** tiff-dict 저장 보정 (복사본 반환) */
export function patchDict(dict: ExifDict, types: ExifDictTypes, out: { width: number; height: number }): { dict: ExifDict; types: ExifDictTypes } {
  const d = clone(dict);
  const t = clone(types);
  d["0th"][0x0112] = 1; t["0th"][0x0112] = "Short";
  d.Exif[0xa002] = out.width; t.Exif[0xa002] = "Long";
  d.Exif[0xa003] = out.height; t.Exif[0xa003] = "Long";
  return { dict: d, types: t };
}

export function dictByteSize(dict: ExifDict, types: ExifDictTypes): number {
  return dumpDict(dict, types).length - 6;
}

export function tiffOrientation(tiff: Uint8Array): number {
  const g = readTiff(tiff);
  const e = g?.ifd0.get(0x0112);
  if (!e || e.type !== 3 || e.bytes.length < 2) return 1;
  return new DataView(e.bytes.buffer, e.bytes.byteOffset, e.bytes.byteLength).getUint16(0, e.littleEndian);
}

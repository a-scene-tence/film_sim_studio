import piexif from "piexifjs";
import { ascii, concat, fromAscii, matches, writeU16be } from "../media/binary";
import { errors } from "../media/errors";
import { parseJpegSegments, segmentPayload, stripSegments } from "../media/jpeg";
import { readTiff } from "../media/tiff";
import { fromBinStr, toBinStr } from "./binstr";
import type { ExifDict, ExifDictTypes, ExifGroup } from "./dict";
import { buildDictFromGroups } from "./extract";
import { dictByteSize, dumpDict, patchDict, patchTiffBytes, tiffOrientation, type ExifPayload } from "./serialize";
import { patchXmp } from "./xmp";

const MAX_PAYLOAD = 65533;
const XMP_NS = "http://ns.adobe.com/xap/1.0/\0";
const EXIF_PREFIX = [0x45, 0x78, 0x69, 0x66, 0, 0];
const hex4 = (n: number) => "0x" + n.toString(16).toUpperCase().padStart(4, "0");

function app(marker: number, body: Uint8Array): Uint8Array {
  return concat([Uint8Array.of(0xff, marker), writeU16be(body.length + 2), body]);
}

/** 크기 한도 초과 시 dict 축소: MakerNote → UserComment → count>1024 BYTE/UNDEFINED(태그번호 오름차순) */
function shrink(dict: ExifDict, types: ExifDictTypes, out: { width: number; height: number }, report: string[]): { dict: ExifDict; types: ExifDictTypes } {
  const fits = () => { const p = patchDict(dict, types, out); return dictByteSize(p.dict, p.types) + 6 <= MAX_PAYLOAD; };
  const drop = (g: ExifGroup, tag: number, why: string) => { delete dict[g][tag]; delete types[g][tag]; report.push(`${why}: 태그 ${hex4(tag)} 제거`); };
  if (!fits() && 0x927c in dict.Exif) drop("Exif", 0x927c, "MakerNote 제거");
  if (!fits() && 0x9286 in dict.Exif) drop("Exif", 0x9286, "UserComment 제거");
  if (!fits()) {
    const big: Array<{ g: ExifGroup; tag: number }> = [];
    for (const g of ["0th", "Exif", "GPS", "Interop"] as ExifGroup[]) {
      for (const k of Object.keys(dict[g])) {
        const tag = Number(k), t = types[g][tag], v = dict[g][tag];
        const n = Array.isArray(v) ? v.length : typeof v === "string" ? v.length : 0;
        if ((t === "Byte" || t === "Undefined") && n > 1024) big.push({ g, tag });
      }
    }
    big.sort((a, b) => a.tag - b.tag);
    for (const b of big) { if (fits()) break; drop(b.g, b.tag, "대용량 BYTE/UNDEFINED 제거"); }
  }
  if (!fits()) throw errors.exifTooLarge();
  return { dict, types };
}

function exifApp1(b: Uint8Array) {
  return parseJpegSegments(b).find((s) => s.marker === 0xe1 && matches(segmentPayload(b, s), 0, EXIF_PREFIX));
}

/** 13.6 JPEG 삽입 */
export function insertExifIntoJpeg(outJpeg: Uint8Array, payload: ExifPayload, outSize: { width: number; height: number }): { bytes: Uint8Array; report: string[] } {
  const report = [...payload.report];
  // 1. APP0(JFIF/JFXX), 모든 APP1, APP13 제거 (APP2 ICC 유지)
  const base = stripSegments(outJpeg, (s, b) => {
    if (s.marker === 0xe1 || s.marker === 0xed) return true;
    if (s.marker === 0xe0) { const d = ascii(segmentPayload(b, s), 0, 5); return d === "JFIF\0" || d === "JFXX\0"; }
    return false;
  });

  // 2~3. TIFF 준비
  let tiffStr: string | null = null;
  if (payload.mode === "tiff-bytes" && payload.tiff) {
    const patched = patchTiffBytes(payload.tiff, outSize, report);
    if (6 + patched.length <= MAX_PAYLOAD) tiffStr = toBinStr(patched);
    else {
      const g = readTiff(payload.tiff);
      if (!g) throw errors.exifTooLarge();
      const tmp: ExifPayload = { ...payload, report: [] };
      buildDictFromGroups(g, tmp, false);
      report.push("Exif 가 64KB 한도를 넘어 tiff-dict 방식으로 전환했습니다", ...tmp.report);
      const s = shrink(tmp.dict!, tmp.dictTypes!, outSize, report);
      const p = patchDict(s.dict, s.types, outSize);
      tiffStr = dumpDict(p.dict, p.types);
    }
  } else if (payload.mode === "tiff-dict" && payload.dict && payload.dictTypes) {
    const dict = JSON.parse(JSON.stringify(payload.dict)) as ExifDict;
    const types = JSON.parse(JSON.stringify(payload.dictTypes)) as ExifDictTypes;
    const s = shrink(dict, types, outSize, report);
    const p = patchDict(s.dict, s.types, outSize);
    tiffStr = dumpDict(p.dict, p.types);
  }

  let bytes = base;
  if (tiffStr !== null) {
    // tiff-bytes 는 "Exif\0\0" + 원본 TIFF, tiff-dict 는 dumpDict 가 이미 접두를 붙인다
    const exifStr = tiffStr.startsWith("Exif\0\0") ? tiffStr : "Exif\0\0" + tiffStr;
    bytes = fromBinStr(piexif.insert(exifStr, toBinStr(base)));
  }

  // 5~6. XMP, IPTC 를 Exif APP1 바로 뒤(없으면 SOI 뒤)에 삽입
  const extra: Uint8Array[] = [];
  if (payload.xmp) {
    const body = concat([fromAscii(XMP_NS), patchXmp(payload.xmp, outSize)]);
    if (body.length <= MAX_PAYLOAD) extra.push(app(0xe1, body));
    else report.push("XMP 가 64KB 한도를 넘어 생략했습니다");
  }
  if (payload.iptcIrb) {
    if (payload.iptcIrb.length <= MAX_PAYLOAD) extra.push(app(0xed, payload.iptcIrb));
    else report.push("IPTC 가 64KB 한도를 넘어 생략했습니다");
  }
  if (extra.length) {
    const ex = exifApp1(bytes);
    const at = ex ? ex.end : 2;
    bytes = concat([bytes.subarray(0, at), ...extra, bytes.subarray(at)]);
  }

  // 7. 검증
  const ex = exifApp1(bytes);
  if (ex) {
    const o = tiffOrientation(segmentPayload(bytes, ex).subarray(6));
    if (o !== 1) throw new Error(`EXIF 검증 실패: Orientation=${o} (1 이어야 함)`);
  }
  return { bytes, report };
}

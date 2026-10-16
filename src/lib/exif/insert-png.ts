import { concat, fromAscii, writeU32be } from "../media/binary";
import { isExifChunk, isXmpChunk, parsePngChunks } from "../media/png-chunks";
import { crc32 } from "./crc32";
import { dumpDictToTiff, patchDict, patchTiffBytes, type ExifPayload } from "./serialize";
import { patchXmp } from "./xmp";
import type { ExifDict, ExifDictTypes } from "./dict";

function chunk(type: string, data: Uint8Array): Uint8Array {
  const t = fromAscii(type);
  return concat([writeU32be(data.length), t, data, writeU32be(crc32(t, data))]);
}

/** 13.7 PNG 삽입: 기존 eXIf / XMP iTXt 제거 후 IHDR 바로 뒤에 eXIf, 그 뒤에 XMP */
export function insertExifIntoPng(outPng: Uint8Array, payload: ExifPayload, outSize: { width: number; height: number }): { bytes: Uint8Array; report: string[] } {
  const report = [...payload.report];
  const chunks = parsePngChunks(outPng).filter((c) => !isExifChunk(c) && !isXmpChunk(c, outPng));
  let tiff: Uint8Array | null = null;
  if (payload.mode === "tiff-bytes" && payload.tiff) tiff = patchTiffBytes(payload.tiff, outSize, report);
  else if (payload.mode === "tiff-dict" && payload.dict && payload.dictTypes) {
    const p = patchDict(JSON.parse(JSON.stringify(payload.dict)) as ExifDict, JSON.parse(JSON.stringify(payload.dictTypes)) as ExifDictTypes, outSize);
    tiff = dumpDictToTiff(p.dict, p.types);
  }
  const inject: Uint8Array[] = [];
  if (tiff) inject.push(chunk("eXIf", tiff));
  if (payload.xmp) inject.push(chunk("iTXt", concat([fromAscii("XML:com.adobe.xmp"), Uint8Array.of(0, 0, 0, 0, 0), patchXmp(payload.xmp, outSize)])));
  if (payload.iptcIrb) report.push("PNG 에는 IPTC 를 기록하지 않음");
  const parts: Uint8Array[] = [outPng.subarray(0, 8)];
  chunks.forEach((c, i) => {
    parts.push(outPng.subarray(c.start, c.end));
    if (i === 0) parts.push(...inject);
  });
  return { bytes: concat(parts), report };
}

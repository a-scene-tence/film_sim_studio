import { ascii, matches, u32be } from "../media/binary";
import { extractHeicMeta } from "../media/heic";
import { children, find, payload, readBoxes } from "../media/isobmff";
import { parseJpegSegments, segmentPayload } from "../media/jpeg";
import { isExifChunk, itxtKeyword, parsePngChunks } from "../media/png-chunks";
import { parseRiff } from "../media/riff";
import { TiffReader, readTiff, type TiffGroups } from "../media/tiff";
import type { SourceFormat } from "../media/types";
import { IFD0_WHITELIST, addGroup, emptyDict, emptyTypes } from "./dict";
import { wrapIptcIrb } from "./iptc";
import type { ExifPayload } from "./serialize";
import { tiffOrientation } from "./serialize";

const XMP_NS = "http://ns.adobe.com/xap/1.0/\0";
const PS = "Photoshop 3.0\0";
const EXIF_PREFIX = [0x45, 0x78, 0x69, 0x66, 0, 0];

function blank(mode: ExifPayload["mode"]): ExifPayload {
  return { mode, tiff: null, dict: null, dictTypes: null, xmp: null, iptcIrb: null, orientation: 1, report: [] };
}

function fromJpeg(b: Uint8Array, p: ExifPayload): void {
  let nExif = 0;
  for (const s of parseJpegSegments(b)) {
    const d = segmentPayload(b, s);
    if (s.marker === 0xe1 && matches(d, 0, EXIF_PREFIX)) {
      if (nExif++ === 0) p.tiff = d.slice(6);
      else p.report.push("두 번째 이후 Exif APP1 세그먼트는 무시했습니다");
    } else if (s.marker === 0xe1 && ascii(d, 0, XMP_NS.length) === XMP_NS) {
      if (!p.xmp) p.xmp = d.slice(XMP_NS.length);
    } else if (s.marker === 0xed && ascii(d, 0, PS.length) === PS) {
      if (!p.iptcIrb) p.iptcIrb = d.slice();
    }
  }
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function fromPng(b: Uint8Array, p: ExifPayload): Promise<void> {
  for (const c of parsePngChunks(b)) {
    if (isExifChunk(c) && !p.tiff) {
      const d = b.subarray(c.dataStart, c.dataEnd);
      p.tiff = (matches(d, 0, EXIF_PREFIX) ? d.subarray(6) : d).slice();
    } else if (c.type === "iTXt" && itxtKeyword(b, c) === "XML:com.adobe.xmp" && !p.xmp) {
      let o = c.dataStart + "XML:com.adobe.xmp".length + 1;
      const compressed = b[o] === 1;
      o += 2;
      while (o < c.dataEnd && b[o] !== 0) o++;
      o++;
      while (o < c.dataEnd && b[o] !== 0) o++;
      o++;
      const text = b.subarray(o, c.dataEnd);
      try { p.xmp = compressed ? await inflate(text) : text.slice(); } catch { p.report.push("PNG XMP 압축 해제 실패"); }
    }
  }
}

function fromWebp(b: Uint8Array, p: ExifPayload): void {
  for (const c of parseRiff(b)) {
    const d = b.subarray(c.dataStart, c.dataStart + c.size);
    if (c.id === "EXIF" && !p.tiff) p.tiff = (matches(d, 0, EXIF_PREFIX) ? d.subarray(6) : d).slice();
    else if (c.id === "XMP " && !p.xmp) p.xmp = d.slice();
  }
}

function fromTiffFamily(b: Uint8Array, p: ExifPayload): void {
  const g = readTiff(b);
  if (!g) { p.report.push("TIFF 구조를 읽지 못했습니다"); return; }
  buildDictFromGroups(g, p, true);
  const x = g.ifd0.get(0x02bc);
  if (x) p.xmp = x.bytes.slice();
  const i = g.ifd0.get(0x83bb);
  if (i) p.iptcIrb = wrapIptcIrb(i.bytes);
}

/** IFD 그룹 → dict. ifd0Whitelist=true 이면 13.2 의 IFD0 화이트리스트만, 아니면 포인터 제외 전체. */
export function buildDictFromGroups(g: Pick<TiffGroups, "ifd0" | "exif" | "gps" | "interop">, p: ExifPayload, ifd0Whitelist: boolean): void {
  const dict = emptyDict(), types = emptyTypes();
  addGroup(dict, types, "0th", g.ifd0, p.report, (t) => (ifd0Whitelist ? IFD0_WHITELIST.has(t) : t !== 0x8769 && t !== 0x8825));
  addGroup(dict, types, "Exif", g.exif, p.report, (t) => t !== 0xa005);
  addGroup(dict, types, "GPS", g.gps, p.report, () => true);
  addGroup(dict, types, "Interop", g.interop, p.report, () => true);
  p.dict = dict;
  p.dictTypes = types;
  p.mode = "tiff-dict";
  const o = g.ifd0.get(0x0112);
  if (o && o.type === 3) p.orientation = new DataView(o.bytes.buffer, o.bytes.byteOffset, o.bytes.byteLength).getUint16(0, o.littleEndian);
}

const CR3_META_UUID = [0x85, 0xc0, 0xb6, 0x87, 0x82, 0x0f, 0x11, 0xe0, 0x81, 0x11, 0xf4, 0xce, 0x46, 0x2b, 0x6a, 0x48];
const CR3_XMP_UUID = [0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac];

function fromCr3(b: Uint8Array, p: ExifPayload): void {
  const top = readBoxes(b, 0, b.length);
  const moov = find(top, "moov");
  const scan = [...top, ...(moov ? children(b, moov) : [])].filter((x) => x.type === "uuid");
  let cmt1: Uint8Array | null = null, cmt2: Uint8Array | null = null, cmt4: Uint8Array | null = null;
  for (const u of scan) {
    if (matches(b, u.payloadStart, CR3_XMP_UUID)) { p.xmp = b.slice(u.payloadStart + 16, u.end); continue; }
    if (!matches(b, u.payloadStart, CR3_META_UUID)) continue;
    for (const k of readBoxes(b, u.payloadStart + 16, u.end)) {
      if (k.type === "CMT1") cmt1 = payload(b, k);
      else if (k.type === "CMT2") cmt2 = payload(b, k);
      else if (k.type === "CMT4") cmt4 = payload(b, k);
    }
  }
  const empty = new Map();
  const rd = (t: Uint8Array | null) => { if (!t) return null; try { const r = new TiffReader(t); return { r, ifd: r.readIfd(r.ifd0Offset).entries }; } catch { return null; } };
  const a = rd(cmt1), e = rd(cmt2), g = rd(cmt4);
  let interop = empty;
  const ip = e?.ifd.get(0xa005);
  if (e && ip) interop = e.r.readIfd(new DataView(ip.bytes.buffer, ip.bytes.byteOffset, 4).getUint32(0, ip.littleEndian)).entries;
  buildDictFromGroups({ ifd0: a?.ifd ?? empty, exif: e?.ifd ?? empty, gps: g?.ifd ?? empty, interop }, p, true);
  p.report.push("CR3 MakerNote 는 오프셋 의존 구조라 제외");
}

/** 13.2 형식별 추출 */
export async function extractPayload(bytes: Uint8Array, format: SourceFormat): Promise<ExifPayload> {
  const p = blank("tiff-bytes");
  switch (format) {
    case "jpeg": fromJpeg(bytes, p); break;
    case "heic": { const r = extractHeicMeta(bytes, p.report); p.tiff = r.tiff; p.xmp = r.xmp; break; }
    case "png": await fromPng(bytes, p); break;
    case "webp": fromWebp(bytes, p); break;
    case "raf": {
      const off = u32be(bytes, 84), len = u32be(bytes, 88);
      if (off > 0 && len > 0 && off + len <= bytes.length) fromJpeg(bytes.subarray(off, off + len), p);
      else p.report.push("RAF 내장 JPEG 위치를 찾지 못했습니다");
      break;
    }
    case "arw": case "nef": case "dng": p.mode = "tiff-dict"; fromTiffFamily(bytes, p); break;
    case "cr3": p.mode = "tiff-dict"; fromCr3(bytes, p); break;
    default: break;
  }
  if (p.mode === "tiff-bytes") p.orientation = p.tiff ? tiffOrientation(p.tiff) : 1;
  return p;
}


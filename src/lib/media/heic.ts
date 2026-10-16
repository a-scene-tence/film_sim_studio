import { ascii, u16be, u32be, u64be } from "./binary";
import { children, find, metaChildrenOffset, readBoxes, type Box } from "./isobmff";
import { classifyIcc } from "./icc";
import type { SourcePrimaries } from "./types";

function meta(b: Uint8Array): { box: Box; kids: Box[] } | null {
  const m = find(readBoxes(b, 0, b.length), "meta");
  if (!m) return null;
  return { box: m, kids: children(b, m, metaChildrenOffset(b, m)) };
}

function readN(b: Uint8Array, o: number, n: number): number {
  if (n === 0) return 0;
  if (n === 4) return u32be(b, o);
  if (n === 8) return u64be(b, o);
  if (n === 2) return u16be(b, o);
  return b[o] ?? 0;
}

interface Item { id: number; type: string; contentType: string }

function parseInfe(b: Uint8Array, box: Box): Item | null {
  const v = b[box.payloadStart]!;
  let o = box.payloadStart + 4;
  let id: number;
  if (v === 2) { id = u16be(b, o); o += 2; } else if (v === 3) { id = u32be(b, o); o += 4; } else return null;
  o += 2; // protection
  const type = ascii(b, o, 4);
  o += 4;
  const strz = () => { let e = o; while (e < box.end && b[e] !== 0) e++; const s = ascii(b, o, e - o); o = e + 1; return s; };
  strz(); // name
  const contentType = type === "mime" ? strz() : "";
  return { id, type, contentType };
}

function items(b: Uint8Array, kids: Box[]): Item[] {
  const iinf = find(kids, "iinf");
  if (!iinf) return [];
  const v = b[iinf.payloadStart]!;
  const skip = 4 + (v === 0 ? 2 : 4);
  return readBoxes(b, iinf.payloadStart + skip, iinf.end).filter((x) => x.type === "infe").map((x) => parseInfe(b, x)).filter((x): x is Item => !!x);
}

/** iloc v0/1/2 — construction_method 0 만 지원. item_ID → 연결된 extent 바이트 */
function itemData(b: Uint8Array, kids: Box[], id: number, report: string[]): Uint8Array | null {
  const iloc = find(kids, "iloc");
  if (!iloc) return null;
  const v = b[iloc.payloadStart]!;
  let o = iloc.payloadStart + 4;
  const offSize = b[o]! >> 4, lenSize = b[o]! & 15;
  const baseSize = b[o + 1]! >> 4, idxSize = v === 1 || v === 2 ? b[o + 1]! & 15 : 0;
  o += 2;
  let count: number;
  if (v < 2) { count = u16be(b, o); o += 2; } else { count = u32be(b, o); o += 4; }
  for (let i = 0; i < count; i++) {
    let itemId: number;
    if (v === 2) { itemId = u32be(b, o); o += 4; } else { itemId = u16be(b, o); o += 2; }
    let method = 0;
    if (v === 1 || v === 2) { method = u16be(b, o) & 15; o += 2; }
    o += 2; // data_reference_index
    const base = readN(b, o, baseSize); o += baseSize;
    const ec = u16be(b, o); o += 2;
    const parts: Uint8Array[] = [];
    for (let k = 0; k < ec; k++) {
      if (idxSize) o += idxSize;
      const eo = readN(b, o, offSize); o += offSize;
      const el = readN(b, o, lenSize); o += lenSize;
      parts.push(b.subarray(base + eo, base + eo + el));
    }
    if (itemId !== id) continue;
    if (method !== 0) { report.push(`HEIC iloc construction_method ${method} 미지원`); return null; }
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let p = 0;
    for (const x of parts) { out.set(x, p); p += x.length; }
    return out;
  }
  return null;
}

/** 13.2 HEIC: Exif 항목 → TIFF(u32 BE 오프셋 n 건너뜀), XMP(mime application/rdf+xml) */
export function extractHeicMeta(b: Uint8Array, report: string[]): { tiff: Uint8Array | null; xmp: Uint8Array | null } {
  const m = meta(b);
  if (!m) return { tiff: null, xmp: null };
  const its = items(b, m.kids);
  let tiff: Uint8Array | null = null;
  let xmp: Uint8Array | null = null;
  const ex = its.find((i) => i.type === "Exif");
  if (ex) {
    const d = itemData(b, m.kids, ex.id, report);
    if (d && d.length > 4) tiff = d.slice(4 + u32be(d, 0));
  }
  const xi = its.find((i) => i.type === "mime" && i.contentType === "application/rdf+xml");
  if (xi) xmp = itemData(b, m.kids, xi.id, report)?.slice() ?? null;
  return { tiff, xmp };
}

function ipco(b: Uint8Array): Box[] {
  const m = meta(b);
  const iprp = m && find(m.kids, "iprp");
  const c = iprp && find(children(b, iprp), "ipco");
  return c ? children(b, c) : [];
}

/** 8.5-4 원색 판정 (nclx / prof·rICC / 기본 srgb) */
export function heicPrimaries(b: Uint8Array): SourcePrimaries {
  for (const p of ipco(b)) {
    if (p.type !== "colr") continue;
    const t = ascii(b, p.payloadStart, 4);
    if (t === "nclx") {
      const pr = u16be(b, p.payloadStart + 4);
      return pr === 12 ? "display-p3" : pr === 9 ? "rec2020" : "srgb";
    }
    if (t === "prof" || t === "rICC") return classifyIcc(b.subarray(p.payloadStart + 4, p.end)).primaries;
  }
  return "srgb";
}

/** 가장 큰 ispe (기본 이미지 크기) */
export function heicSize(b: Uint8Array): { width: number; height: number } | null {
  let best: { width: number; height: number } | null = null;
  for (const p of ipco(b)) {
    if (p.type !== "ispe") continue;
    const w = u32be(b, p.payloadStart + 4), h = u32be(b, p.payloadStart + 8);
    if (!best || w * h > best.width * best.height) best = { width: w, height: h };
  }
  return best;
}

/** irot(회전) 반영 표시 크기 — HEIF 의 irot/imir 는 디코드 단계에서 적용되므로 ispe 가 회전 전 값이다 */
export function heicDisplaySize(b: Uint8Array): { width: number; height: number } | null {
  const s = heicSize(b);
  if (!s) return null;
  const irot = ipco(b).find((p) => p.type === "irot");
  const odd = irot ? (b[irot.payloadStart]! & 3) % 2 === 1 : false;
  return odd ? { width: s.height, height: s.width } : s;
}

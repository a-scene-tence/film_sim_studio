import { concat, u16be } from "./binary";

export interface JpegSegment { marker: number; offset: number; length: number; end: number }
export interface JpegCandidate { offset: number; length: number; width: number; height: number }

const NO_LEN = (m: number) => m === 0x01 || (m >= 0xd0 && m <= 0xd7);

/** 8.2-1 SOI 부터 SOS(포함)까지 세그먼트 목록. length 는 길이 필드 값(길이 없는 마커는 0), end 는 세그먼트 끝 오프셋(SOS 는 헤더 끝). */
export function parseJpegSegments(b: Uint8Array): JpegSegment[] {
  const segs: JpegSegment[] = [];
  if (b[0] !== 0xff || b[1] !== 0xd8) return segs;
  segs.push({ marker: 0xd8, offset: 0, length: 0, end: 2 });
  let p = 2;
  while (p + 1 < b.length) {
    if (b[p] !== 0xff) break;
    while (b[p + 1] === 0xff) p++;
    const m = b[p + 1]!;
    if (m === 0xd9) break;
    if (NO_LEN(m)) { segs.push({ marker: m, offset: p, length: 0, end: p + 2 }); p += 2; continue; }
    const len = u16be(b, p + 2);
    if (len < 2 || p + 2 + len > b.length) break;
    segs.push({ marker: m, offset: p, length: len, end: p + 2 + len });
    if (m === 0xda) break;
    p += 2 + len;
  }
  return segs;
}

/** 조건에 맞는 SOS 이전 세그먼트를 제거한 사본 */
export function stripSegments(b: Uint8Array, pred: (seg: JpegSegment, b: Uint8Array) => boolean): Uint8Array {
  const segs = parseJpegSegments(b);
  const parts: Uint8Array[] = [];
  let last = 0;
  for (const s of segs) {
    if (s.marker !== 0xda && s.marker !== 0xd8 && pred(s, b)) {
      parts.push(b.subarray(last, s.offset));
      last = s.end;
    }
  }
  parts.push(b.subarray(last));
  return concat(parts);
}

/** 모든 APP1 제거 (APP2 ICC 는 유지) */
export function stripApp1(b: Uint8Array): Uint8Array {
  return stripSegments(b, (s) => s.marker === 0xe1);
}

export function readSof(b: Uint8Array): { width: number; height: number; marker: number } | null {
  for (const s of parseJpegSegments(b)) {
    if (s.marker === 0xc0 || s.marker === 0xc1 || s.marker === 0xc2) return { marker: s.marker, height: u16be(b, s.offset + 5), width: u16be(b, s.offset + 7) };
  }
  return null;
}

/** 세그먼트 데이터 (마커·길이 필드 제외) */
export function segmentPayload(b: Uint8Array, s: JpegSegment): Uint8Array {
  return b.subarray(s.offset + 4, s.end);
}

const LOSSLESS = new Set([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** 9.1 파일 전체 바이트에서 JPEG 후보 스캔 (최대 64개, 길이 ≥ 1024) */
export function scanEmbeddedJpegs(b: Uint8Array): JpegCandidate[] {
  const out: JpegCandidate[] = [];
  let p = 0;
  while (p + 3 <= b.length && out.length < 64) {
    p = b.indexOf(0xff, p);
    if (p < 0 || p + 3 > b.length) break;
    if (b[p + 1] !== 0xd8 || b[p + 2] !== 0xff) { p++; continue; }
    const r = tryParse(b, p);
    if (r && r.end - p >= 1024) { out.push({ offset: p, length: r.end - p, width: r.w, height: r.h }); p = r.end; }
    else p++;
  }
  return out;
}

function tryParse(b: Uint8Array, p: number): { end: number; w: number; h: number } | null {
  let q = p + 2;
  let sof: { w: number; h: number } | null = null;
  for (let guard = 0; guard < 100000; guard++) {
    if (b[q] !== 0xff) return null;
    while (b[q + 1] === 0xff) q++;
    const m = b[q + 1];
    if (m === undefined) return null;
    if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7)) return null;
    if (q + 4 > b.length) return null;
    const len = u16be(b, q + 2);
    if (len < 2 || q + 2 + len > b.length) return null;
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
      const P = b[q + 4]!, H = u16be(b, q + 5), W = u16be(b, q + 7), Nf = b[q + 9]!;
      if (P !== 8 || W < 8 || H < 8 || (Nf !== 1 && Nf !== 3)) return null;
      sof = { w: W, h: H };
    } else if (LOSSLESS.has(m)) return null;
    if (m === 0xda) {
      if (!sof) return null;
      let e = q + 2 + len;
      for (;;) {
        e = b.indexOf(0xff, e);
        if (e < 0 || e + 1 >= b.length) return null;
        const n = b[e + 1]!;
        if (n === 0x00 || (n >= 0xd0 && n <= 0xd7) || n === 0xff) { e += n === 0xff ? 1 : 2; continue; }
        if (n === 0xd9) return { end: e + 2, w: sof.w, h: sof.h };
        q = e;
        break;
      }
      continue;
    }
    q += 2 + len;
  }
  return null;
}

/** 선택: W×H 최대, 동률이면 오프셋이 작은 것 */
export function pickLargest(c: JpegCandidate[]): JpegCandidate | null {
  let best: JpegCandidate | null = null;
  for (const x of c) if (!best || x.width * x.height > best.width * best.height || (x.width * x.height === best.width * best.height && x.offset < best.offset)) best = x;
  return best;
}

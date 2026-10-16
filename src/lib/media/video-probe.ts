import { ascii, u16be, u32be, u64be } from "./binary";
import { parseEbml } from "./ebml";
import { errors } from "./errors";
import { children, find, metaChildrenOffset, payload, readBoxes, type Box } from "./isobmff";
import type { VideoInfo } from "./types";

export interface VideoConfigBox { kind: "avcC" | "hvcC"; payload: Uint8Array }
export interface FirstSample { offset: number; size: number; keyFirst: boolean }
export interface Mp4Probe {
  codecFourcc: string; codec: string; width: number; height: number; fps: number; durationSec: number; bitDepth: number;
  hasAudio: boolean; audioCodec: string | null; audioSampleRate: number | null;
  colour: VideoInfo["colour"]; make: string | null; model: string | null; creationTime: string | null;
  config: VideoConfigBox | null; firstSample: FirstSample | null;
}
export interface ProbeResult {
  info: VideoInfo; metaText: string; config: VideoConfigBox | null; firstSample: FirstSample | null;
}

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
export function reverseBits32(n: number): number {
  let r = 0;
  for (let i = 0; i < 32; i++) { r = (r << 1) | (n & 1); n >>>= 1; }
  return r >>> 0;
}

/** 11.1 avcC → "avc1.PPCCLL", bitDepth */
export function avcCodec(b: Uint8Array): { codec: string; bitDepth: number } {
  return { codec: "avc1." + hex2(b[1]!) + hex2(b[2]!) + hex2(b[3]!), bitDepth: b[1] === 110 || b[1] === 122 || b[1] === 244 ? 10 : 8 };
}

/** 11.1 hvcC → "hvc1.profile.compat.Tlevel.constraints" */
export function hevcCodec(fourcc: string, b: Uint8Array): { codec: string; bitDepth: number } {
  const space = b[1]! >> 6, tier = (b[1]! >> 5) & 1, profile = b[1]! & 31;
  const compat = u32be(b, 2);
  let last = 5;
  while (last >= 0 && b[6 + last] === 0) last--;
  let c = fourcc + "." + ["", "A", "B", "C"][space] + profile + "." + reverseBits32(compat).toString(16).toUpperCase() + "." + (tier ? "H" : "L") + b[12];
  for (let i = 0; i <= last; i++) c += "." + hex2(b[6 + i]!);
  return { codec: c, bitDepth: (b[17]! & 7) + 8 };
}

function mdhd(b: Uint8Array, box: Box): { timescale: number; duration: number } {
  const v = b[box.payloadStart]!;
  const o = box.payloadStart;
  return v === 1 ? { timescale: u32be(b, o + 20), duration: u64be(b, o + 24) } : { timescale: u32be(b, o + 12), duration: u32be(b, o + 16) };
}

function isoFromMac(secs: number): string | null {
  if (!secs) return null;
  const ms = (secs - 2082844800) * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function utf8(b: Uint8Array): string { return new TextDecoder("utf-8").decode(b).replace(/\0+$/g, ""); }

function metaMakeModel(b: Uint8Array, moov: Box): { make: string | null; model: string | null } {
  const vals: Record<string, string> = {};
  const metas: Box[] = [];
  const kids = children(b, moov);
  for (const k of kids) {
    if (k.type === "meta") metas.push(k);
    if (k.type === "udta") {
      for (const u of children(b, k)) {
        if (u.type === "meta") metas.push(u);
        else if (u.type === "\xa9mak" || u.type === "\xa9mod") {
          const len = u16be(b, u.payloadStart);
          vals[u.type === "\xa9mak" ? "udta.make" : "udta.model"] = utf8(b.subarray(u.payloadStart + 4, u.payloadStart + 4 + len));
        }
      }
    }
  }
  for (const m of metas) {
    const mk = children(b, m, metaChildrenOffset(b, m));
    const keys = find(mk, "keys");
    const ilst = find(mk, "ilst");
    if (!keys || !ilst) continue;
    const names: string[] = [];
    let o = keys.payloadStart + 8;
    const n = u32be(b, keys.payloadStart + 4);
    for (let i = 0; i < n && o + 8 <= keys.end; i++) {
      const sz = u32be(b, o);
      names.push(ascii(b, o + 8, sz - 8));
      o += sz;
    }
    for (const it of readBoxes(b, ilst.payloadStart, ilst.end)) {
      const idx = ((it.type.charCodeAt(0) << 24) | (it.type.charCodeAt(1) << 16) | (it.type.charCodeAt(2) << 8) | it.type.charCodeAt(3)) >>> 0;
      const name = names[idx - 1];
      const data = find(children(b, it), "data");
      if (name && data) vals[name] = utf8(b.subarray(data.payloadStart + 8, data.end));
    }
  }
  return {
    make: vals["com.apple.quicktime.make"] ?? vals["com.android.manufacturer"] ?? vals["udta.make"] ?? null,
    model: vals["com.apple.quicktime.model"] ?? vals["com.android.model"] ?? vals["udta.model"] ?? null,
  };
}

const PRORES = new Set(["apch", "apcn", "apcs", "apco", "ap4h", "ap4x"]);

/** moov 박스 전체(헤더 포함, 오프셋 0)를 파싱한다. */
export function parseMoov(b: Uint8Array): Mp4Probe {
  const top = readBoxes(b, 0, b.length);
  const moov = find(top, "moov");
  if (!moov) throw errors.decodeFailed("moov 박스를 찾을 수 없습니다");
  const kids = children(b, moov);
  const mvhd = find(kids, "mvhd");
  let creationTime: string | null = null;
  if (mvhd) creationTime = isoFromMac(b[mvhd.payloadStart] === 1 ? u64be(b, mvhd.payloadStart + 4) : u32be(b, mvhd.payloadStart + 4));

  const out: Mp4Probe = {
    codecFourcc: "", codec: "", width: 0, height: 0, fps: 0, durationSec: 0, bitDepth: 8, hasAudio: false, audioCodec: null, audioSampleRate: null,
    colour: { primaries: null, transfer: null, matrix: null, fullRange: null }, make: null, model: null, creationTime, config: null, firstSample: null,
  };
  let gotVideo = false;
  for (const trak of kids.filter((k) => k.type === "trak")) {
    const mdia = find(children(b, trak), "mdia");
    if (!mdia) continue;
    const mk = children(b, mdia);
    const hdlr = find(mk, "hdlr");
    const handler = hdlr ? ascii(b, hdlr.payloadStart + 8, 4) : "";
    const md = find(mk, "mdhd");
    const { timescale, duration } = md ? mdhd(b, md) : { timescale: 0, duration: 0 };
    const minf = find(mk, "minf");
    const stbl = minf && find(children(b, minf), "stbl");
    if (!stbl) continue;
    const sb = children(b, stbl);
    const stsd = find(sb, "stsd");
    const entry = stsd ? readBoxes(b, stsd.payloadStart + 8, stsd.end)[0] : undefined;
    if (!entry) continue;
    if (handler === "soun") {
      if (!out.hasAudio) {
        out.hasAudio = true;
        out.audioCodec = entry.type;
        out.audioSampleRate = u32be(b, entry.start + 32) >>> 16;
      }
      continue;
    }
    if (handler !== "vide" || gotVideo) continue;
    gotVideo = true;
    out.codecFourcc = entry.type;
    out.width = u16be(b, entry.start + 32);
    out.height = u16be(b, entry.start + 34);
    out.durationSec = timescale ? duration / timescale : 0;
    out.codec = entry.type;
    out.bitDepth = PRORES.has(entry.type) ? 10 : 8;
    for (const c of readBoxes(b, entry.start + 86, entry.end)) {
      if (c.type === "avcC") { const p = payload(b, c); out.config = { kind: "avcC", payload: p.slice() }; const r = avcCodec(p); out.codec = r.codec; out.bitDepth = r.bitDepth; }
      else if (c.type === "hvcC") { const p = payload(b, c); out.config = { kind: "hvcC", payload: p.slice() }; const r = hevcCodec(entry.type, p); out.codec = r.codec; out.bitDepth = r.bitDepth; }
      else if (c.type === "colr") {
        const t = ascii(b, c.payloadStart, 4);
        if (t === "nclx" || t === "nclc") {
          out.colour = { primaries: u16be(b, c.payloadStart + 4), transfer: u16be(b, c.payloadStart + 6), matrix: u16be(b, c.payloadStart + 8), fullRange: t === "nclx" ? (b[c.payloadStart + 10]! >> 7) === 1 : false };
        }
      }
    }
    const stts = find(sb, "stts");
    if (stts && timescale) {
      const n = u32be(b, stts.payloadStart + 4);
      let best = 0, delta = 0;
      for (let i = 0; i < n; i++) {
        const c = u32be(b, stts.payloadStart + 8 + i * 8);
        if (c > best) { best = c; delta = u32be(b, stts.payloadStart + 12 + i * 8); }
      }
      if (delta > 0) out.fps = timescale / delta;
    }
    // 첫 샘플 위치
    const stsz = find(sb, "stsz");
    const stco = find(sb, "stco"), co64 = find(sb, "co64");
    const stss = find(sb, "stss");
    if (stsz && (stco || co64)) {
      const fixed = u32be(b, stsz.payloadStart + 4);
      const size = fixed !== 0 ? fixed : u32be(b, stsz.payloadStart + 12);
      const offset = stco ? u32be(b, stco.payloadStart + 8) : u64be(b, co64!.payloadStart + 8);
      const keyFirst = !stss || u32be(b, stss.payloadStart + 8) === 1;
      out.firstSample = { offset, size, keyFirst };
    }
  }
  const mm = metaMakeModel(b, moov);
  out.make = mm.make;
  out.model = mm.model;
  return out;
}

async function readRange(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, Math.min(blob.size, end)).arrayBuffer());
}

const MB = 2 ** 20;
const SKIP_TEXT = new Set(["mdat", "free", "skip", "wide"]);

function latin1Lower(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000) as unknown as number[]);
  return s.toLowerCase();
}

function webmCodec(id: string): { codec: string; fourcc: string } {
  switch (id) {
    case "V_VP8": return { codec: "vp8", fourcc: "vp08" };
    case "V_VP9": return { codec: "vp09.00.10.08", fourcc: "vp09" };
    case "V_AV1": return { codec: "av01.0.08M.08", fourcc: "av01" };
    default: return { codec: id.toLowerCase(), fourcc: id.slice(0, 4).toLowerCase() };
  }
}

/** 11.1 메타데이터. Blob.slice 로 필요한 박스만 읽는다 (전체 로드 금지). */
export async function probeVideo(file: Blob, container: "mp4" | "mov" | "webm"): Promise<ProbeResult> {
  if (container === "webm") {
    const e = parseEbml(await readRange(file, 0, 4 * MB));
    const c = webmCodec(e.codecId);
    const bitrate = e.durationSec > 0 ? Math.round((file.size * 8) / e.durationSec) : 0;
    return {
      metaText: "", config: null, firstSample: null,
      info: {
        container, codec: c.codec, codecFourcc: c.fourcc, width: e.width, height: e.height, fps: e.fps, durationSec: e.durationSec, bitDepth: e.bitDepth,
        hasAudio: e.hasAudio, audioCodec: e.audioCodec, audioSampleRate: e.audioSampleRate, colour: e.colour, make: null, model: null, creationTime: null,
        bitrateBps: bitrate, playback4k60: null,
      },
    };
  }
  const tops: Array<{ type: string; start: number; size: number }> = [];
  let pos = 0;
  while (pos + 8 <= file.size) {
    const h = await readRange(file, pos, pos + 16);
    let size = u32be(h, 0);
    const type = ascii(h, 4, 4);
    if (size === 1) size = u64be(h, 8);
    else if (size === 0) size = file.size - pos;
    if (size < 8) break;
    tops.push({ type, start: pos, size });
    pos += size;
  }
  const moovTop = tops.find((t) => t.type === "moov");
  if (!moovTop) throw errors.decodeFailed("moov 박스를 찾을 수 없습니다 (스트리밍용으로 끝이 잘린 파일일 수 있습니다)");
  if (moovTop.size > 64 * MB) throw errors.decodeFailed("moov 박스가 64MB 를 넘습니다");
  const moovBytes = await readRange(file, moovTop.start, moovTop.start + moovTop.size);
  const p = parseMoov(moovBytes);
  let text = "";
  for (const t of tops) {
    if (SKIP_TEXT.has(t.type)) continue;
    const bytes = t === moovTop ? moovBytes.subarray(0, 8 * MB) : await readRange(file, t.start, t.start + Math.min(t.size, 8 * MB));
    text += latin1Lower(bytes) + "\n";
  }
  const bitrate = p.durationSec > 0 ? Math.round((file.size * 8) / p.durationSec) : 0;
  return {
    metaText: text, config: p.config, firstSample: p.firstSample,
    info: {
      container, codec: p.codec, codecFourcc: p.codecFourcc, width: p.width, height: p.height, fps: p.fps, durationSec: p.durationSec, bitDepth: p.bitDepth,
      hasAudio: p.hasAudio, audioCodec: p.audioCodec, audioSampleRate: p.audioSampleRate, colour: p.colour, make: p.make, model: p.model,
      creationTime: p.creationTime, bitrateBps: bitrate, playback4k60: null,
    },
  };
}

/** 4K60 판정 (API 없으면 null) */
export async function playback4k60(info: VideoInfo): Promise<VideoInfo["playback4k60"]> {
  try {
    const mc = (globalThis.navigator as Navigator | undefined)?.mediaCapabilities;
    if (!mc) return null;
    const r = await mc.decodingInfo({
      type: "file",
      video: { contentType: `video/${info.container === "webm" ? "webm" : "mp4"}; codecs="${info.codec}"`, width: info.width, height: info.height, bitrate: info.bitrateBps, framerate: info.fps },
    });
    return { supported: r.supported, smooth: r.smooth, powerEfficient: r.powerEfficient };
  } catch {
    return null;
  }
}

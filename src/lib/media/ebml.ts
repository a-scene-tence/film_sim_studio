/** 11.1 EBML(webm) 메타데이터 — 앞 4MB 만 읽는다. */
export interface EbmlInfo {
  width: number; height: number; codecId: string; fps: number; durationSec: number; bitDepth: number;
  hasAudio: boolean; audioCodec: string | null; audioSampleRate: number | null;
  colour: { primaries: number | null; transfer: number | null; matrix: number | null; fullRange: boolean | null };
}

const ID = {
  Segment: 0x18538067, Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Duration: 0x4489, Tracks: 0x1654ae6b, TrackEntry: 0xae,
  TrackType: 0x83, CodecID: 0x86, DefaultDuration: 0x23e383, Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba, Colour: 0x55b0,
  MatrixCoefficients: 0x55b1, BitsPerChannel: 0x55b2, Range: 0x55b9, TransferCharacteristics: 0x55ba, Primaries: 0x55bb,
  Audio: 0xe1, SamplingFrequency: 0xb5, Cluster: 0x1f43b675,
};

function readId(b: Uint8Array, p: number): { id: number; len: number } | null {
  const f = b[p];
  if (!f) return null;
  let len = 1;
  while (len <= 4 && !(f & (0x80 >> (len - 1)))) len++;
  if (len > 4 || p + len > b.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + b[p + i]!;
  return { id, len };
}

function readSize(b: Uint8Array, p: number): { size: number; len: number; unknown: boolean } | null {
  const f = b[p];
  if (f === undefined) return null;
  let len = 1;
  while (len <= 8 && !(f & (0x80 >> (len - 1)))) len++;
  if (len > 8 || p + len > b.length) return null;
  let v = f & (0xff >> len);
  let allOnes = v === (0xff >> len);
  for (let i = 1; i < len; i++) { const x = b[p + i]!; v = v * 256 + x; if (x !== 0xff) allOnes = false; }
  return { size: v, len, unknown: allOnes };
}

function uint(b: Uint8Array, s: number, e: number): number { let v = 0; for (let i = s; i < e; i++) v = v * 256 + b[i]!; return v; }
function flt(b: Uint8Array, s: number, e: number): number {
  const dv = new DataView(b.buffer, b.byteOffset + s, e - s);
  return e - s === 4 ? dv.getFloat32(0) : e - s === 8 ? dv.getFloat64(0) : 0;
}
function str(b: Uint8Array, s: number, e: number): string { let r = ""; for (let i = s; i < e && b[i] !== 0; i++) r += String.fromCharCode(b[i]!); return r; }

interface Track { type: number; codec: string; defDur: number; w: number; h: number; bits: number; primaries: number | null; transfer: number | null; matrix: number | null; range: number | null; sr: number }

export function parseEbml(bytes: Uint8Array): EbmlInfo {
  let timecodeScale = 1_000_000;
  let duration = 0;
  const tracks: Track[] = [];
  let cur: Track | null = null;
  let done = false;

  const walk = (s: number, e: number): void => {
    let p = s;
    while (p < e && !done) {
      const id = readId(bytes, p);
      if (!id) return;
      const sz = readSize(bytes, p + id.len);
      if (!sz) return;
      const ds = p + id.len + sz.len;
      const de = sz.unknown ? e : Math.min(e, ds + sz.size);
      switch (id.id) {
        case ID.Cluster: done = true; return;
        case ID.Segment: case ID.Info: case ID.Tracks: case ID.Video: case ID.Colour: case ID.Audio: walk(ds, de); break;
        case ID.TrackEntry:
          cur = { type: 0, codec: "", defDur: 0, w: 0, h: 0, bits: 0, primaries: null, transfer: null, matrix: null, range: null, sr: 0 };
          walk(ds, de);
          tracks.push(cur);
          cur = null;
          break;
        case ID.TimecodeScale: timecodeScale = uint(bytes, ds, de); break;
        case ID.Duration: duration = flt(bytes, ds, de); break;
        case ID.TrackType: if (cur) cur.type = uint(bytes, ds, de); break;
        case ID.CodecID: if (cur) cur.codec = str(bytes, ds, de); break;
        case ID.DefaultDuration: if (cur) cur.defDur = uint(bytes, ds, de); break;
        case ID.PixelWidth: if (cur) cur.w = uint(bytes, ds, de); break;
        case ID.PixelHeight: if (cur) cur.h = uint(bytes, ds, de); break;
        case ID.BitsPerChannel: if (cur) cur.bits = uint(bytes, ds, de); break;
        case ID.MatrixCoefficients: if (cur) cur.matrix = uint(bytes, ds, de); break;
        case ID.Range: if (cur) cur.range = uint(bytes, ds, de); break;
        case ID.TransferCharacteristics: if (cur) cur.transfer = uint(bytes, ds, de); break;
        case ID.Primaries: if (cur) cur.primaries = uint(bytes, ds, de); break;
        case ID.SamplingFrequency: if (cur) cur.sr = flt(bytes, ds, de); break;
        default: break;
      }
      if (sz.unknown) return;
      p = de;
    }
  };
  walk(0, bytes.length);

  const v = tracks.find((t) => t.type === 1);
  const a = tracks.find((t) => t.type === 2);
  return {
    width: v?.w ?? 0, height: v?.h ?? 0, codecId: v?.codec ?? "",
    fps: v && v.defDur > 0 ? 1e9 / v.defDur : 0,
    durationSec: (duration * timecodeScale) / 1e9,
    bitDepth: v?.bits || 8,
    hasAudio: !!a, audioCodec: a?.codec ?? null, audioSampleRate: a && a.sr ? a.sr : null,
    colour: { primaries: v?.primaries ?? null, transfer: v?.transfer ?? null, matrix: v?.matrix ?? null, fullRange: v?.range == null ? null : v.range === 2 },
  };
}

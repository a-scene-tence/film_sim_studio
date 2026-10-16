import type { SourceFormat } from "../media/types";
import type { ExifPayload } from "./serialize";

export interface ExifSummary {
  body: string | null; lens: string | null; focalLength: string | null; aperture: string | null; shutter: string | null; iso: string | null;
  exposureComp: string | null; dateTime: string | null; colorSpace: string | null; gps: string | null; altitude: string | null;
  software: string | null; artist: string | null; copyright: string | null; originalSize: string | null; fileSize: string | null; format: string | null;
}
export interface ExifGroupView { id: string; label: string; rows: Array<{ key: string; value: string }> }
export interface ExifExtractionPublic { summary: ExifSummary; groups: ExifGroupView[]; payload: ExifPayload }

/** 요약 계산에 필요한 호출자 정보 */
export interface SummaryContext {
  format: SourceFormat;
  byteSize: number;
  displaySize: { width: number; height: number } | null;
  lastModified: number | null;
  iccDescription: string | null;
  libraw: { lensName?: string; timestamp?: Date | number | null } | null;
}

type Tags = Record<string, unknown>;
export interface NumericExif { ifd0: Tags; exif: Tags; gps: Tags; interop: Tags }

const MINUS = "−";

const str = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\0+$/g, "").trim();
  return t ? t : null;
};
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (Array.isArray(v) && typeof v[0] === "number") return v[0];
  if (v && typeof v === "object" && ArrayBuffer.isView(v)) return (v as unknown as ArrayLike<number>)[0] ?? null;
  if (v && typeof v === "object" && "0" in v) { const x = (v as Record<string, unknown>)["0"]; return typeof x === "number" ? x : null; }
  return null;
};
const nums = (v: unknown): number[] | null => {
  if (Array.isArray(v) && v.every((x) => typeof x === "number")) return v as number[];
  if (v && typeof v === "object" && ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>);
  return null;
};
/** 소수 1자리, ".0" 제거 */
export const fmt1 = (n: number): string => n.toFixed(1).replace(/\.0$/, "");

export function formatShutter(t: number): string {
  if (t >= 1) return `${fmt1(t)}초`;
  const inv = 1 / t;
  if (Math.abs(inv - Math.round(inv)) < 0.05 * inv) return `1/${Math.round(inv)}`;
  return `${fmt1(t)}초`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${fmt1(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${fmt1(n / 1024 / 1024)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

const p2 = (n: number) => String(n).padStart(2, "0");
function fmtDate(d: Date, utc: boolean): string {
  const g = utc
    ? [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
    : [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];
  return `${g[0]}.${p2(g[1]!)}.${p2(g[2]!)} ${p2(g[3]!)}:${p2(g[4]!)}:${p2(g[5]!)}`;
}

function dateFromExif(s: string): string | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  return m ? `${m[1]}.${m[2]}.${m[3]} ${m[4]}:${m[5]}:${m[6]}` : null;
}

function dms(v: unknown, ref: unknown, neg: string): number | null {
  const a = nums(v);
  if (!a || a.length < 3) return null;
  const r = str(ref);
  return (a[0]! + a[1]! / 60 + a[2]! / 3600) * (r === neg ? -1 : 1);
}

/** 13.8 요약. 입력은 숫자 태그 키 (translateKeys:false) */
export function buildSummary(t: NumericExif, ctx: SummaryContext): ExifSummary {
  const { ifd0, exif, gps } = t;
  const make = str(ifd0[0x010f]);
  const model = str(ifd0[0x0110]);
  let body: string | null = null;
  if (model) body = make && !model.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${model}` : model;
  else if (make) body = make;
  body = body ? body.replace(/\s+/g, " ").trim() : null;

  const lm = str(exif[0xa434]);
  const lk = str(exif[0xa433]);
  let lens: string | null = null;
  if (lm) lens = lk && !lm.toLowerCase().startsWith(lk.toLowerCase()) ? `${lk} ${lm}` : lm;
  else lens = ctx.libraw?.lensName?.trim() || null;

  const fl = num(exif[0x920a]);
  const fl35 = num(exif[0xa405]);
  let focalLength: string | null = null;
  if (fl !== null) {
    focalLength = `${fmt1(fl)}mm`;
    if (fl35 !== null && fl35 > 0 && Math.abs(fl35 - fl) > 1e-9) focalLength += ` (35mm 환산 ${fmt1(fl35)}mm)`;
  }
  const fn = num(exif[0x829d]);
  const et = num(exif[0x829a]);
  const iso = num(exif[0x8827]);
  const ec = num(exif[0x9204]);
  const exposureComp = ec === null ? null : ec === 0 ? "0 EV" : `${ec < 0 ? MINUS : "+"}${fmt1(Math.abs(ec))} EV`;

  // 촬영일시: 0x9003 → 0x9004 → 0x0132 → LibRaw timestamp → 파일 수정 시각
  let dateTime: string | null = null;
  for (const v of [exif[0x9003], exif[0x9004], ifd0[0x0132]]) {
    const s = str(v);
    const f = s ? dateFromExif(s) : null;
    if (f) { dateTime = f; break; }
  }
  if (dateTime) {
    const off = str(exif[0x9011]);
    if (off) dateTime += ` ${off}`;
  } else if (ctx.libraw?.timestamp && new Date(ctx.libraw.timestamp).getTime() > 0) {
    dateTime = fmtDate(new Date(ctx.libraw.timestamp), true);
  } else if (ctx.lastModified) {
    dateTime = `${fmtDate(new Date(ctx.lastModified), false)} (파일 수정 시각)`;
  }

  const cs = num(exif[0xa001]);
  const colorSpace = ctx.iccDescription || (cs === 1 ? "sRGB" : cs === 0xffff ? "Uncalibrated" : null);

  let gpsText: string | null = null;
  let altitude: string | null = null;
  if (gps[0x0002] !== undefined) {
    const lat = dms(gps[0x0002], gps[0x0001], "S");
    const lon = dms(gps[0x0004], gps[0x0003], "W");
    if (lat !== null && lon !== null) gpsText = `${Math.abs(lat).toFixed(6)}${lat < 0 ? "S" : "N"}, ${Math.abs(lon).toFixed(6)}${lon < 0 ? "W" : "E"}`;
    const alt = num(gps[0x0006]);
    if (alt !== null) altitude = `${(alt * (num(gps[0x0005]) === 1 ? -1 : 1)).toFixed(1)}m`;
  }

  return {
    body,
    lens: lens ?? null,
    focalLength,
    aperture: fn === null ? null : `f/${fmt1(fn)}`,
    shutter: et === null || et <= 0 ? null : formatShutter(et),
    iso: iso === null ? null : `ISO ${iso}`,
    exposureComp,
    dateTime,
    colorSpace,
    gps: gpsText,
    altitude,
    software: str(ifd0[0x0131]),
    artist: str(ifd0[0x013b]),
    copyright: str(ifd0[0x8298]),
    originalSize: ctx.displaySize ? `${ctx.displaySize.width}×${ctx.displaySize.height}` : null,
    fileSize: formatBytes(ctx.byteSize),
    format: ctx.format.toUpperCase(),
  };
}

// Step 4 §7-6 EXIF 요약 카드 포맷터. 입력은 exifr 로 파싱한 평탄 태그(이름 키) 객체.
export type Tags = Record<string, unknown>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : Array.isArray(v) && typeof v[0] === "number" ? v[0] : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.replace(/\0+$/g, "").trim() ? v.replace(/\0+$/g, "").trim() : null);
const trim1 = (n: number) => n.toFixed(1).replace(/\.0$/, "");

/** 바디 = Make + " " + Model. Model 이 Make 로 시작하면 Model 만 */
export function formatBody(make: unknown, model: unknown): string {
  const mk = str(make), md = str(model);
  if (!mk && !md) return "—";
  if (!mk) return md!;
  if (!md) return mk;
  return md.toLowerCase().startsWith(mk.toLowerCase()) ? md : `${mk} ${md}`;
}

export function formatLens(t: Tags): string {
  return str(t.LensModel) ?? str(t.LensMake) ?? "—";
}

export const formatAperture = (f: unknown): string => { const n = num(f); return n === null ? "—" : `f/${trim1(n)}`; };

export function formatShutterSpeed(v: unknown): string {
  const t = num(v);
  if (t === null || !(t > 0)) return "—";
  return t >= 1 ? `${trim1(t)} s` : `1/${Math.round(1 / t)} s`;
}

export function formatIso(t: Tags): string {
  for (const k of ["ISO", "ISOSpeedRatings", "PhotographicSensitivity"]) {
    const n = num(t[k]);
    if (n !== null) return String(n);
  }
  return "—";
}

export function formatFocalLength(fl: unknown, fl35: unknown): string {
  const f = num(fl);
  if (f === null) return "—";
  const e = num(fl35);
  return e === null ? `${trim1(f)} mm` : `${trim1(f)} mm (35mm 환산 ${trim1(e)} mm)`;
}

export function formatDateTime(t: Tags): string {
  const d = t.DateTimeOriginal;
  let base: string | null = null;
  if (d instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    base = `${d.getUTCFullYear()}:${p(d.getUTCMonth() + 1)}:${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  } else base = str(d);
  if (!base) return "—";
  const off = str(t.OffsetTimeOriginal);
  return off ? `${base} ${off}` : base;
}

export interface ExifCard { body: string; lens: string; aperture: string; shutter: string; iso: string; focal: string; dateTime: string; resolution: string }

export function buildExifCard(t: Tags, display: { width: number; height: number } | null): ExifCard {
  return {
    body: formatBody(t.Make, t.Model), lens: formatLens(t), aperture: formatAperture(t.FNumber), shutter: formatShutterSpeed(t.ExposureTime),
    iso: formatIso(t), focal: formatFocalLength(t.FocalLength, t.FocalLengthIn35mmFormat), dateTime: formatDateTime(t),
    resolution: display ? `${display.width} × ${display.height}` : "—",
  };
}

import type { ExifGroupView } from "./summary";

type Exifr = typeof import("exifr").default;
type ExifrOptions = Parameters<Exifr["parse"]>[1];

/** exifr 는 별도 청크로 지연 로드한다 (서버 프리렌더에서 평가하지 않고, 초기 JS 를 키우지 않기 위해) */
async function exifr(): Promise<Exifr> {
  return (await import("exifr")).default;
}

type Tags = Record<string, unknown>;

/** 13.8 요약용 파싱 옵션 (숫자 태그 키) */
export const SUMMARY_OPTIONS = {
  tiff: true, ifd0: true, ifd1: false, exif: true, gps: true, interop: true, makerNote: false, userComment: false, xmp: false, icc: false,
  iptc: false, jfif: false, ihdr: false, translateKeys: false, translateValues: false, reviveValues: false, sanitize: false, mergeOutput: false, silentErrors: true,
};
/** 13.8 전체 보기용 파싱 옵션 */
export const FULL_OPTIONS = {
  tiff: true, ifd0: true, ifd1: true, exif: true, gps: true, interop: true, xmp: true, icc: true, iptc: true, makerNote: false, userComment: true,
  translateKeys: true, translateValues: true, reviveValues: true, mergeOutput: false, silentErrors: true,
};

export async function parseSummaryTags(tiff: Uint8Array): Promise<{ ifd0: Tags; exif: Tags; gps: Tags; interop: Tags }> {
  const r = ((await (await exifr()).parse(tiff, SUMMARY_OPTIONS as unknown as ExifrOptions)) ?? {}) as Record<string, Tags | undefined>;
  return { ifd0: r.ifd0 ?? {}, exif: r.exif ?? {}, gps: r.gps ?? {}, interop: r.interop ?? {} };
}

const p2 = (n: number) => String(n).padStart(2, "0");

function fmtValue(v: unknown, key: string): string {
  if (v instanceof Date) return `${v.getUTCFullYear()}.${p2(v.getUTCMonth() + 1)}.${p2(v.getUTCDate())} ${p2(v.getUTCHours())}:${p2(v.getUTCMinutes())}:${p2(v.getUTCSeconds())}`;
  if (v instanceof Uint8Array) {
    const head = Array.from(v.subarray(0, 32), (x) => x.toString(16).padStart(2, "0")).join(" ");
    return `${head} (총 ${v.length}바이트)`;
  }
  if (Array.isArray(v)) return v.map((x) => fmtValue(x, key)).join(", ");
  if (typeof v === "string") return key === "xmp" ? v.slice(0, 2000) : v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    // 숫자 키 객체는 바이트 배열로 직렬화된 것
    if ("0" in o && Object.keys(o).every((k) => /^\d+$/.test(k))) return fmtValue(Uint8Array.from(Object.values(o) as number[]), key);
    return JSON.stringify(o);
  }
  return String(v);
}

const LABELS: Array<[string, string]> = [["ifd0", "IFD0"], ["exif", "Exif"], ["gps", "GPS"], ["interop", "Interop"], ["ifd1", "IFD1"], ["iptc", "IPTC"], ["icc", "ICC"], ["xmp", "XMP"]];

export interface FullParse { groups: ExifGroupView[]; iccDescription: string | null }

/** 13.8 전체 보기: 그룹(ifd0, exif, gps, interop, ifd1, iptc, icc, xmp) × (키, 값) */
export async function parseFullView(input: Uint8Array): Promise<FullParse> {
  const r = ((await (await exifr()).parse(input, FULL_OPTIONS as unknown as ExifrOptions)) ?? {}) as Record<string, unknown>;
  const groups: ExifGroupView[] = [];
  for (const [id, label] of LABELS) {
    const g = r[id];
    if (g == null) continue;
    if (typeof g === "string") { groups.push({ id, label, rows: [{ key: id, value: fmtValue(g, id) }] }); continue; }
    const rows = Object.entries(g as Tags).map(([key, v]) => ({ key, value: fmtValue(v, id) }));
    if (rows.length) groups.push({ id, label, rows });
  }
  const icc = r.icc as Tags | undefined;
  const d = icc && (icc.ProfileDescription ?? icc.ProfileDescriptionTag ?? icc.Description);
  return { groups, iccDescription: typeof d === "string" && d.trim() ? d.trim() : null };
}

// EXIF 파사드 (CLAUDE.md §2-10). UI 는 src/lib/exif/* 를 직접 import 하지 않는다.
import { MediaError, errors } from "./media/errors";
import type { SourceFormat } from "./media/types";
import { parseFullView, parseSummaryTags } from "./exif/display";
import { extractPayload } from "./exif/extract";
import { insertExifIntoJpeg as insertJpeg } from "./exif/insert-jpeg";
import { insertExifIntoPng as insertPng } from "./exif/insert-png";
import { dumpDictToTiff, type ExifPayload } from "./exif/serialize";
import { buildSummary, type ExifGroupView, type ExifSummary, type SummaryContext } from "./exif/summary";

export type { ExifPayload } from "./exif/serialize";
export type { ExifSummary, ExifGroupView } from "./exif/summary";
export interface ExifExtraction { summary: ExifSummary; groups: ExifGroupView[]; payload: ExifPayload }

/** rawMeta: 호출자가 아는 추가 정보 (파일 크기, 표시 크기, lastModified, LibRaw 메타데이터) */
export interface ExifRawMeta {
  byteSize?: number;
  displaySize?: { width: number; height: number };
  lastModified?: number;
  libraw?: { lens?: { Lens?: string } | null; timestamp?: Date | number | null } | null;
}

const FILE_INPUT_FORMATS = new Set<SourceFormat>(["jpeg", "heic", "png", "arw", "dng", "nef"]);

export async function extractExif(bytes: Uint8Array, format: SourceFormat, rawMeta?: unknown): Promise<ExifExtraction> {
  const meta = (rawMeta ?? {}) as ExifRawMeta;
  const payload = await extractPayload(bytes, format);
  let tiff: Uint8Array | null = payload.tiff;
  if (payload.mode === "tiff-dict" && payload.dict && payload.dictTypes) {
    try { tiff = dumpDictToTiff(payload.dict, payload.dictTypes); } catch (e) { payload.report.push(`dict 직렬화 실패: ${e instanceof Error ? e.message : String(e)}`); }
  }

  let groups: ExifGroupView[] = [];
  let iccDescription: string | null = null;
  try {
    const input = FILE_INPUT_FORMATS.has(format) ? bytes : tiff;
    if (input) { const f = await parseFullView(input); groups = f.groups; iccDescription = f.iccDescription; }
  } catch (e) {
    payload.report.push(errors.exifParse(e instanceof Error ? e.message : String(e)).message);
  }

  let tags = { ifd0: {}, exif: {}, gps: {}, interop: {} } as Awaited<ReturnType<typeof parseSummaryTags>>;
  try {
    if (tiff) tags = await parseSummaryTags(tiff);
  } catch (e) {
    payload.report.push(errors.exifParse(e instanceof Error ? e.message : String(e)).message);
  }
  const ctx: SummaryContext = {
    format,
    byteSize: meta.byteSize ?? bytes.length,
    displaySize: meta.displaySize ?? null,
    lastModified: meta.lastModified ?? null,
    iccDescription,
    libraw: meta.libraw ? { lensName: meta.libraw.lens?.Lens, timestamp: meta.libraw.timestamp ?? null } : null,
  };
  return { summary: buildSummary(tags, ctx), groups, payload };
}

export function insertExifIntoJpeg(outJpeg: Uint8Array, payload: ExifPayload, outSize: { width: number; height: number }): { bytes: Uint8Array; report: string[] } {
  try { return insertJpeg(outJpeg, payload, outSize); } catch (e) { if (e instanceof MediaError) throw e; throw errors.exifParse(e instanceof Error ? e.message : String(e)); }
}

export function insertExifIntoPng(outPng: Uint8Array, payload: ExifPayload, outSize: { width: number; height: number }): { bytes: Uint8Array; report: string[] } {
  return insertPng(outPng, payload, outSize);
}

const ROWS: Array<[keyof ExifSummary, string]> = [
  ["body", "바디"], ["lens", "렌즈"], ["focalLength", "초점거리"], ["aperture", "조리개"], ["shutter", "셔터"], ["iso", "ISO"],
  ["exposureComp", "노출보정"], ["dateTime", "촬영일시"], ["colorSpace", "색공간"], ["gps", "GPS"], ["altitude", "고도"],
  ["software", "소프트웨어"], ["artist", "작가"], ["copyright", "저작권"], ["originalSize", "원본 크기"], ["fileSize", "파일 크기"], ["format", "형식"],
];

export function formatSummaryRows(summary: ExifSummary): Array<{ label: string; value: string }> {
  return ROWS.map(([k, label]) => ({ label, value: summary[k] ?? (k === "gps" ? "위치 정보 없음" : "정보 없음") }));
}

/** Step 4 §7-6 요약 카드용: 이름 키 평탄 태그 (ifd0+exif, 날짜는 Date). 읽을 수 없으면 빈 객체 */
export async function readExifTags(src: Blob): Promise<Record<string, unknown>> {
  try {
    const exifr = (await import("exifr")).default;
    const opts = {
      tiff: true, ifd0: true, exif: true, gps: false, interop: false, ifd1: false, makerNote: false, userComment: false, xmp: false, icc: false, iptc: false, jfif: false, ihdr: false,
      mergeOutput: true, translateKeys: true, translateValues: false, reviveValues: true, sanitize: false, silentErrors: true,
    };
    const r = await exifr.parse(src, opts as unknown as Parameters<typeof exifr.parse>[1]);
    return (r ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export interface OutputExifReport {
  orientation: number;
  pixelX: number | null;
  pixelY: number | null;
  hasThumbnail: boolean;
  make: string | null;
  gps: boolean;
}

/** Step 4 §10-4(4) 삽입 후 검증: 출력 바이트에서 EXIF 를 다시 파싱한다 (Orientation, PixelXDimension/YDimension, IFD1, GPS) */
export async function inspectOutputExif(bytes: Uint8Array, format: "jpeg" | "png"): Promise<OutputExifReport> {
  const payload = await extractPayload(bytes, format);
  const tiff = payload.tiff;
  const empty: OutputExifReport = { orientation: payload.orientation, pixelX: null, pixelY: null, hasThumbnail: false, make: null, gps: false };
  if (!tiff) return empty;
  const exifr = (await import("exifr")).default;
  const opts = { tiff: true, ifd0: true, exif: true, gps: true, interop: false, ifd1: true, makerNote: false, xmp: false, icc: false, iptc: false, translateKeys: true, translateValues: false, reviveValues: false, mergeOutput: false, silentErrors: true };
  const r = ((await exifr.parse(tiff, opts as unknown as Parameters<typeof exifr.parse>[1])) ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const mk = r.ifd0?.Make;
  return {
    orientation: payload.orientation,
    pixelX: num(r.exif?.ExifImageWidth), pixelY: num(r.exif?.ExifImageHeight),
    hasThumbnail: r.ifd1 !== undefined && Object.keys(r.ifd1).length > 0,
    make: typeof mk === "string" ? mk.replace(/\0+$/g, "") : null,
    gps: r.gps !== undefined && Object.keys(r.gps).length > 0,
  };
}

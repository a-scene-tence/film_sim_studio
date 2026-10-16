export type MediaErrorCode =
  | "UNSUPPORTED_FORMAT" | "UNSUPPORTED_CODEC" | "DECODE_FAILED" | "OUT_OF_MEMORY_BUDGET" | "NOT_CROSS_ORIGIN_ISOLATED"
  | "PQ_UNSUPPORTED" | "SOURCE_TRANSFORM_LUT_REQUIRED" | "EXIF_PARSE_FAILED" | "EXIF_TOO_LARGE";
export type MediaWarningCode = "RAW_PREVIEW_ONLY" | "REDUCED_DECODE" | "ORIENTATION_MISMATCH";

export const SUPPORTED_EXTENSIONS = "ARW, DNG, RAF, CR3, NEF, JPG, JPEG, PNG, WEBP, HEIC, MP4, MOV, WEBM";

/** 사용자 대면 메시지는 한국어, 원인과 해결 방법을 함께 적는다 (CLAUDE.md §7). */
export class MediaError extends Error {
  readonly code: MediaErrorCode;
  constructor(code: MediaErrorCode, message: string) {
    super(message);
    this.name = "MediaError";
    this.code = code;
  }
}

export const errors = {
  unsupportedFormat: (ext: string) => new MediaError("UNSUPPORTED_FORMAT", `지원하지 않는 형식입니다: ${ext || "(확장자 없음)"} — ${SUPPORTED_EXTENSIONS} 파일을 선택하세요.`),
  unsupportedCodec: (codec: string) => new MediaError("UNSUPPORTED_CODEC", `이 기기 브라우저가 디코드할 수 없는 코덱입니다: ${codec} — H.264/HEVC 로 다시 내보내거나 다른 브라우저에서 열어 주세요.`),
  decodeFailed: (detail: string) => new MediaError("DECODE_FAILED", `파일을 디코드하지 못했습니다 (${detail}) — 파일이 손상되었거나 일부만 전송되었을 수 있습니다. 파일을 다시 복사해 시도하세요.`),
  outOfMemory: () => new MediaError("OUT_OF_MEMORY_BUDGET", "기기 메모리 한도로 원본 해상도 현상이 불가합니다. 절반 해상도로 저장됩니다"),
  notCrossOriginIsolated: () => new MediaError("NOT_CROSS_ORIGIN_ISOLATED", "RAW 현상에는 교차 출처 격리(COOP/COEP)가 필요합니다 — HTTPS 배포 주소 또는 npm run dev 로 접속하세요. 내장 프리뷰로 대신 엽니다."),
  pq: () => new MediaError("PQ_UNSUPPORTED", "HDR10(PQ) 영상은 지원하지 않습니다"),
  sourceLutRequired: () => new MediaError("SOURCE_TRANSFORM_LUT_REQUIRED", "공식 변환 LUT 등록이 필요합니다 — /lab/luts 에서 등록"),
  exifParse: (detail: string) => new MediaError("EXIF_PARSE_FAILED", `EXIF 를 읽지 못했습니다 (${detail}) — 이미지는 열리지만 촬영 정보가 표시되지 않을 수 있습니다.`),
  exifTooLarge: () => new MediaError("EXIF_TOO_LARGE", "EXIF 가 JPEG 한도(64KB)를 넘어 저장할 수 없습니다 — PNG 로 저장하거나 EXIF 없이 저장하세요."),
};

export const warnings = {
  rawPreviewOnly: "RAW 현상 실패 — 내장 프리뷰(JPEG)로 표시합니다",
  reducedDecode: (w: number, h: number) => `메모리 한도로 축소 디코드했습니다 (원본 ${w}×${h})`,
  orientationMismatch: (exif: number, flip: number) => `방향 불일치: EXIF ${exif} / LibRaw flip → ${flip}. LibRaw 값으로 통일했습니다`,
  unknownIcc: (desc: string) => `알 수 없는 ICC: ${desc}`,
  sourceLutRequired: "공식 변환 LUT 등록이 필요합니다 — /lab/luts 에서 등록",
  videoThumbnailApprox: "썸네일은 브라우저 색 변환을 거친 8bit 값이라 정확한 YUV→RGB 정규화는 Step 4 셰이더에서 처리합니다",
};

export function toErrorInfo(e: unknown): { code: string; message: string } {
  if (e instanceof MediaError) return { code: e.code, message: e.message };
  const c = (e as { code?: unknown } | null)?.code;
  const m = e instanceof Error ? e.message : String(e);
  if (typeof c === "string" && /^[A-Z_]+$/.test(c)) return { code: c, message: m };
  return { code: "DECODE_FAILED", message: errors.decodeFailed(m).message };
}

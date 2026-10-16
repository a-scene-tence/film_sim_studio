export type MediaKind = "raw" | "image" | "video";
export type SourceFormat = "jpeg" | "png" | "webp" | "heic" | "arw" | "dng" | "nef" | "raf" | "cr3" | "mp4" | "mov" | "webm";
export type SourceProfileId = "srgb-image" | "rec709" | "hlg" | "pq" | "slog3" | "slog2" | "flog" | "flog2" | "clog3" | "vlog" | "nlog" | "dlog" | "applelog" | "samsunglog" | "dlogm" | "raw-linear";
export type SourcePrimaries = "srgb" | "display-p3" | "adobe-rgb" | "rec2020" | "s-gamut3-cine" | "s-gamut3" | "cinema-gamut" | "v-gamut" | "d-gamut" | "f-gamut-c";
export interface SourceDescriptor { profile: SourceProfileId; primaries: SourcePrimaries; range: "full" | "limited"; bitDepth: number; rawScale: number | null; }
/** RGBA 인터리브. 값은 "소스 인코딩 그대로"의 0~1 실수(RAW 는 선형 v/65535), 알파 1. 방향 보정 적용 후 표시 방향 */
export interface PixelBufferF32 { width: number; height: number; data: Float32Array; }
export interface VideoInfo { container: "mp4" | "mov" | "webm"; codec: string; codecFourcc: string; width: number; height: number; fps: number; durationSec: number; bitDepth: number; hasAudio: boolean; audioCodec: string | null; audioSampleRate: number | null; colour: { primaries: number | null; transfer: number | null; matrix: number | null; fullRange: boolean | null }; make: string | null; model: string | null; creationTime: string | null; bitrateBps: number; playback4k60: { supported: boolean; smooth: boolean; powerEfficient: boolean } | null; rotation: VideoRotation; }
/** Step 3 섹션 10.1: 비디오 트랙 tkhd 행렬 a,b,c,d (16.16 원값), EXIF 동등 방향, tkhd 폭·높이(coded) */
export interface VideoRotation { matrix: [number, number, number, number]; orientation: number; codedWidth: number; codedHeight: number; }
export interface LogDetection { profile: SourceProfileId; primaries: SourcePrimaries; confidence: "tag" | "metadata" | "filename" | "histogram-suggestion" | "default"; autoApply: boolean; candidates: SourceProfileId[]; evidence: string[]; requiresSourceLut: boolean; approximate: boolean; }
export interface HistogramStats { bins1024: Uint32Array; p0_1: number; p0_5: number; p50: number; p99_5: number; p99_9: number; logLike: boolean; sampleCount: number; }
export interface MediaAsset { id: string; kind: MediaKind; format: SourceFormat; fileName: string; byteSize: number; displaySize: { width: number; height: number }; orientation: number; descriptor: SourceDescriptor; proxy: PixelBufferF32; previewOnly: boolean; video: VideoInfo | null; detection: LogDetection | null; histogram: HistogramStats | null; exif: import("../exif/summary").ExifExtractionPublic | null; decodeStrategy: string; warnings: string[]; }

export type LoadStage = "sniff" | "metadata" | "preview" | "decode" | "proxy" | "analyze" | "done";

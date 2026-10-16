// Step 4 §11-2 동영상 저장 계획 — 순수 함수 + 주입 가능한 기기 능력 (테스트 가능). mediabunny 를 import 하지 않는다.
export type VideoCodecId = "avc" | "hevc" | "vp9" | "vp8";
export type AudioCodecId = string;
export type ContainerId = "mp4" | "webm" | "recorder" | "none";

export const ev = (v: number): number => 2 * Math.round(v / 2);

/** 1080p 크기: s = min(W,H) ≤ 1080 이면 (ev(W), ev(H)), 아니면 k = 1080/s */
export function video1080(dw: number, dh: number): { width: number; height: number } {
  const s = Math.min(dw, dh);
  if (s <= 1080) return { width: ev(dw), height: ev(dh) };
  const k = 1080 / s;
  return dw <= dh ? { width: 1080, height: ev(dh * k) } : { width: ev(dw * k), height: 1080 };
}

export const originalSize = (dw: number, dh: number): { width: number; height: number } => ({ width: ev(dw), height: ev(dh) });
/** 짧은 변이 1080 이하이면 1080p 칩을 숨긴다 */
export const has1080Option = (dw: number, dh: number): boolean => Math.min(dw, dh) > 1080;

/** fpsOut = min(60, src), resample = (src > 60.5) */
export function fpsPlan(src: number): { fpsOut: number; resample: boolean } {
  return { fpsOut: Math.min(60, src), resample: src > 60.5 };
}

/** B = min(100e6, max(4e6, round(W·H·fps·0.1))) */
export function videoBitrate(W: number, H: number, fps: number): number {
  return Math.min(100e6, Math.max(4e6, Math.round(W * H * fps * 0.1)));
}

/** 대조 표 (회전, 반전) → 잔여 orientation 1..8 */
export function rotationToOrientation(rotation: number, flip: boolean): number {
  const r = ((Math.round(rotation / 90) % 4) + 4) % 4;
  const plain = [1, 6, 3, 8] as const;
  const flipped = [2, 5, 4, 7] as const;
  return (flip ? flipped : plain)[r]!;
}

export const WARN_W1 = "일부 기기 사진첩에서 소리가 재생되지 않을 수 있습니다";
export const WARN_W2 = "원본 오디오를 담을 수 없어 소리 없이 저장됩니다";

export interface AudioPlan { mode: "none" | "copy" | "transcode"; codec: AudioCodecId | null; warning: string | null }
export interface AudioCaps {
  canDecode: boolean;
  canEncode(codec: AudioCodecId): boolean;
  containerSupports(codec: AudioCodecId): boolean;
  hasDecoderConfig: boolean;
}

/** audioPlan(container, ac, caps) — 트랙이 없는 경우(none, 경고 없음)는 호출자가 먼저 처리한다 */
export function audioPlan(container: "mp4" | "webm", ac: AudioCodecId | null, caps: AudioCaps): AudioPlan {
  const copy = (warning: string | null = null): AudioPlan => ({ mode: "copy", codec: ac, warning });
  const tr = (codec: AudioCodecId, warning: string | null = null): AudioPlan => ({ mode: "transcode", codec, warning });
  if (container === "mp4") {
    if (ac === "aac" && caps.hasDecoderConfig) return copy();
    if (caps.canDecode && caps.canEncode("aac")) return tr("aac");
    if (ac !== null && caps.containerSupports(ac) && caps.hasDecoderConfig) return copy(WARN_W1);
    if (caps.canDecode && caps.canEncode("opus")) return tr("opus", WARN_W1);
    return { mode: "none", codec: null, warning: WARN_W2 };
  }
  if ((ac === "opus" || ac === "vorbis") && caps.hasDecoderConfig) return copy();
  if (caps.canDecode && caps.canEncode("opus")) return tr("opus");
  if (caps.canDecode && caps.canEncode("vorbis")) return tr("vorbis");
  return { mode: "none", codec: null, warning: WARN_W2 };
}

export const NO_AUDIO: AudioPlan = { mode: "none", codec: null, warning: null };

/**
 * Step 5 §2 무음 영상 허용: 오디오 트랙이 없으면 경고 없이 비디오만 인코딩한다(NO_AUDIO).
 * 트랙이 있어도 코덱 탐지가 실패하면 영상 저장을 거부하지 않고 소리 없이 저장한다(WARN_W2).
 */
export async function planAudioSafe(hasTrack: boolean, container: "mp4" | "webm", probe: () => Promise<{ codec: AudioCodecId | null; caps: AudioCaps }>): Promise<AudioPlan> {
  if (!hasTrack) return NO_AUDIO;
  try {
    const { codec, caps } = await probe();
    return audioPlan(container, codec, caps);
  } catch {
    return { mode: "none", codec: null, warning: WARN_W2 };
  }
}

/** 예상 용량: est = round(((B + Ba)/8)·D), Ba = copy ? (원본 비트레이트 ?? 192000) : transcode ? 192000 : 0 */
export function estimateVideoBytes(B: number, audio: AudioPlan, sourceAudioBitrate: number | null, durationSec: number): number {
  const Ba = audio.mode === "copy" ? (sourceAudioBitrate ?? 192000) : audio.mode === "transcode" ? 192000 : 0;
  return Math.round(((B + Ba) / 8) * durationSec);
}

/** 메모리 검사: 2·est > 0.6·budget 이면 해당 해상도는 저장하기 어렵다 */
export const videoTooLarge = (estBytes: number, budgetBytes: number): boolean => 2 * estBytes > 0.6 * budgetBytes;

export const MSG_ORIGINAL_TOO_LARGE = "원본 해상도는 이 기기 메모리로 저장하기 어렵습니다. 1080p 를 선택하세요.";
export const MSG_VIDEO_TOO_LONG = "영상이 길어 이 기기에서 한 번에 저장할 수 없습니다";
export const MSG_NO_ENCODER = "이 기기는 동영상 인코딩을 지원하지 않습니다";
export const MSG_RECORDER = "이 기기는 고속 인코딩을 지원하지 않아 실시간 녹화 방식으로 저장합니다. 영상 길이만큼 시간이 걸립니다.";

export interface CodecPick { container: ContainerId; codec: VideoCodecId | null }
export interface CodecCaps {
  /** 주어진 후보 중 처음으로 인코드 가능한 코덱 (없으면 null) */
  firstEncodable(candidates: VideoCodecId[]): Promise<VideoCodecId | null>;
  hasMediaRecorder: boolean;
}

/** 컨테이너/코덱 순서: MP4(avc, hevc) → WebM(vp9, vp8) → MediaRecorder 실시간 녹화 → 불가 */
export async function pickContainerCodec(caps: CodecCaps): Promise<CodecPick> {
  const mp4 = await caps.firstEncodable(["avc", "hevc"]);
  if (mp4) return { container: "mp4", codec: mp4 };
  const webm = await caps.firstEncodable(["vp9", "vp8"]);
  if (webm) return { container: "webm", codec: webm };
  return { container: caps.hasMediaRecorder ? "recorder" : "none", codec: null };
}

const VCODEC_LABEL: Record<VideoCodecId, string> = { avc: "H.264", hevc: "HEVC", vp9: "VP9", vp8: "VP8" };
const ACODEC_LABEL: Record<string, string> = { aac: "AAC", opus: "Opus", vorbis: "Vorbis", mp3: "MP3", flac: "FLAC", "pcm-s16": "PCM" };

/** 형식 줄: "MP4 · H.264 · AAC(원본 오디오 복사)" / "MP4 · HEVC · AAC(변환)" / "WebM · VP9 · Opus(변환)" / "MP4 · H.264 · 오디오 없음" */
export function formatLine(pick: CodecPick, audio: AudioPlan): string {
  if (pick.container === "recorder") return "실시간 녹화 (MediaRecorder)";
  if (pick.container === "none" || !pick.codec) return "저장 불가";
  const c = pick.container === "mp4" ? "MP4" : "WebM";
  const a = audio.mode === "none" ? "오디오 없음" : `${ACODEC_LABEL[audio.codec ?? ""] ?? String(audio.codec).toUpperCase()}(${audio.mode === "copy" ? "원본 오디오 복사" : "변환"})`;
  return `${c} · ${VCODEC_LABEL[pick.codec]} · ${a}`;
}

/** fps 줄: "{fps} fps", 원본이 60 을 넘으면 "60 fps (원본 {x} fps)" */
export function fpsLine(src: number, out: number): string {
  const r = (x: number) => String(Math.round(x * 100) / 100);
  return src > 60.5 ? `${r(out)} fps (원본 ${r(src)} fps)` : `${r(out)} fps`;
}

/** 진행 문구: "{p}% · 남은 시간 약 {m}분 {s}초" (p ≥ 2% 부터 ETA). ETA = 경과·(1−p)/p */
export function progressLine(p: number, elapsedSec: number): string {
  const pct = Math.round(p * 100);
  if (p < 0.02) return `${pct}%`;
  const eta = Math.round((elapsedSec * (1 - p)) / p);
  return `${pct}% · 남은 시간 약 ${Math.floor(eta / 60)}분 ${eta % 60}초`;
}

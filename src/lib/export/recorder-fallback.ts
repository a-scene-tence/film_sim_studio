// Step 4 §11-5 실시간 녹화 폴백 (WebCodecs 인코더를 쓸 수 없을 때만): 영상 길이만큼 걸린다.
import type { MediaAsset } from "../media-loader";
import { FilmRenderer } from "../render/renderer";
import type { RenderParams } from "../render/params";
import { exportName } from "./filename";
import type { ExportJob } from "./photo-export";
import { ExportCancelled } from "./worker-client";
import type { VideoPlanInfo, VideoResult, VideoVariant } from "./video-export";

// Step 5 §2: 갤럭시(Android Chrome)·아이폰(iOS Safari) 기본 갤러리 호환을 위해 MP4 를 최우선으로 탐색하고, 미지원 브라우저에서만 WebM 으로 폴백한다.
export const RECORDER_MIME_CANDIDATES = [
  "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4;codecs=hvc1", "video/mp4", 'video/webm;codecs="vp9,opus"', 'video/webm;codecs="vp8,opus"', "video/webm",
] as const;

/** 무음 영상 후보: 오디오 코덱을 지정하지 않는다 (오디오 트랙이 없는 스트림에 mp4a 를 요구하지 않는다) */
export const RECORDER_MIME_CANDIDATES_SILENT = [
  "video/mp4;codecs=avc1", "video/mp4;codecs=hvc1", "video/mp4", 'video/webm;codecs="vp9"', 'video/webm;codecs="vp8"', "video/webm",
] as const;

/** 처음 통과한 mimeType (없으면 null). hasAudio=false 면 무음 후보를 쓴다 */
export function pickRecorderMime(isSupported: (t: string) => boolean, hasAudio = true): string | null {
  return (hasAudio ? RECORDER_MIME_CANDIDATES : RECORDER_MIME_CANDIDATES_SILENT).find((t) => isSupported(t)) ?? null;
}

/** mimeType → 저장 확장자 (MP4 계열만 mp4, 나머지는 webm) */
export function recorderExt(mime: string): "mp4" | "webm" {
  return mime.split(";")[0]!.trim().toLowerCase() === "video/mp4" ? "mp4" : "webm";
}

export async function recordViaMediaRecorder(a: {
  file: File; asset: MediaAsset; params: RenderParams; variant: VideoVariant; plan: VideoPlanInfo; simId: string | null; job: ExportJob; start: Date; onProgress(p: number): void;
}): Promise<VideoResult> {
  const hasAudio = a.asset.video?.hasAudio !== false;
  const mimeType = pickRecorderMime((t) => MediaRecorder.isTypeSupported(t), hasAudio);
  if (!mimeType) throw new Error("이 기기는 동영상 인코딩을 지원하지 않습니다");
  const canvas = document.createElement("canvas");
  const renderer = FilmRenderer.create(canvas, { preserveDrawingBuffer: true });
  let ctx: AudioContext | null = null;
  let rec: MediaRecorder | null = null;
  try {
    renderer.setParams(a.params);
    await renderer.whenReady();
    await renderer.setVideoSource(a.asset, a.file); // Step 3 <video> + requestVideoFrameCallback 경로 (회전 프로브 규칙 포함)
    const video = renderer.video.element();
    if (!video) throw new Error("영상을 열지 못했습니다 — 다른 파일로 다시 시도하세요");
    video.currentTime = 0;
    const fps = a.plan.fpsOut;
    const stream = canvas.captureStream(fps);
    if (hasAudio) {
      // 오디오 트랙이 있을 때만 오디오 스트림을 결합한다 (무음 영상은 비디오만 녹화)
      ctx = new AudioContext();
      const node = ctx.createMediaElementSource(video);
      const dest = ctx.createMediaStreamDestination();
      node.connect(dest); // ctx.destination 에는 연결하지 않으므로 녹화 중 소리가 나지 않는다
      for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
    }
    rec = new MediaRecorder(stream, hasAudio ? { mimeType, videoBitsPerSecond: a.variant.bitrate, audioBitsPerSecond: 192000 } : { mimeType, videoBitsPerSecond: a.variant.bitrate });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    const stopped = new Promise<void>((res) => { rec!.onstop = () => res(); });
    rec.start(1000);
    const timer = setInterval(() => {
      if (a.job.cancelled) { clearInterval(timer); rec?.stop(); video.pause(); }
      else if (video.duration > 0) a.onProgress(Math.min(1, video.currentTime / video.duration));
    }, 250);
    const ended = new Promise<void>((res) => video.addEventListener("ended", () => res(), { once: true }));
    await ctx?.resume();
    await renderer.video.play();
    await Promise.race([ended, stopped]);
    clearInterval(timer);
    if (a.job.cancelled) throw new ExportCancelled();
    if (rec.state !== "inactive") rec.stop();
    await stopped;
    const type = mimeType.split(";")[0]!;
    const ext = recorderExt(type);
    const blob = new Blob(chunks, { type });
    const file = new File([blob], exportName(a.asset.fileName, a.simId, a.start, ext), { type });
    return { blob, file, width: canvas.width, height: canvas.height, bytes: blob.size, warnings: [], mime: type, ext };
  } finally {
    if (rec && rec.state !== "inactive") rec.stop();
    void ctx?.close();
    renderer.dispose();
  }
}

// Step 4 §11-5 실시간 녹화 폴백 (WebCodecs 인코더를 쓸 수 없을 때만): 영상 길이만큼 걸린다.
import type { MediaAsset } from "../media-loader";
import { FilmRenderer } from "../render/renderer";
import type { RenderParams } from "../render/params";
import { exportName } from "./filename";
import type { ExportJob } from "./photo-export";
import { ExportCancelled } from "./worker-client";
import type { VideoPlanInfo, VideoResult, VideoVariant } from "./video-export";

export const RECORDER_MIME_CANDIDATES = [
  'video/mp4;codecs="avc1.640028,mp4a.40.2"', "video/mp4", 'video/webm;codecs="vp9,opus"', 'video/webm;codecs="vp8,opus"', "video/webm",
] as const;

/** 처음 통과한 mimeType (없으면 null) */
export function pickRecorderMime(isSupported: (t: string) => boolean): string | null {
  return RECORDER_MIME_CANDIDATES.find((t) => isSupported(t)) ?? null;
}

export async function recordViaMediaRecorder(a: {
  file: File; asset: MediaAsset; params: RenderParams; variant: VideoVariant; plan: VideoPlanInfo; simId: string | null; job: ExportJob; start: Date; onProgress(p: number): void;
}): Promise<VideoResult> {
  const mimeType = pickRecorderMime((t) => MediaRecorder.isTypeSupported(t));
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
    ctx = new AudioContext();
    const node = ctx.createMediaElementSource(video);
    const dest = ctx.createMediaStreamDestination();
    node.connect(dest); // ctx.destination 에는 연결하지 않으므로 녹화 중 소리가 나지 않는다
    const fps = a.plan.fpsOut;
    const stream = canvas.captureStream(fps);
    for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
    rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: a.variant.bitrate, audioBitsPerSecond: 192000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    const stopped = new Promise<void>((res) => { rec!.onstop = () => res(); });
    rec.start(1000);
    const timer = setInterval(() => {
      if (a.job.cancelled) { clearInterval(timer); rec?.stop(); video.pause(); }
      else if (video.duration > 0) a.onProgress(Math.min(1, video.currentTime / video.duration));
    }, 250);
    const ended = new Promise<void>((res) => video.addEventListener("ended", () => res(), { once: true }));
    await ctx.resume();
    await renderer.video.play();
    await Promise.race([ended, stopped]);
    clearInterval(timer);
    if (a.job.cancelled) throw new ExportCancelled();
    if (rec.state !== "inactive") rec.stop();
    await stopped;
    const type = mimeType.split(";")[0]!;
    const ext = type === "video/mp4" ? "mp4" : "webm";
    const blob = new Blob(chunks, { type });
    const file = new File([blob], exportName(a.asset.fileName, a.simId, a.start, ext), { type });
    return { blob, file, width: canvas.width, height: canvas.height, bytes: blob.size, warnings: [], mime: type, ext };
  } finally {
    if (rec && rec.state !== "inactive") rec.stop();
    void ctx?.close();
    renderer.dispose();
  }
}

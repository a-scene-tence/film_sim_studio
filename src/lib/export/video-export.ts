// Step 4 §11 동영상 저장: mediabunny 저수준 API (Conversion 은 쓰지 않는다 — 프레임을 프리뷰와 같은 업로드 경로로 직접 렌더하기 위해).
import {
  ALL_FORMATS, AudioSampleSink, AudioSampleSource, BlobSource, BufferTarget, CanvasSource, EncodedAudioPacketSource, EncodedPacketSink, getFirstEncodableVideoCodec,
  canEncodeAudio, Input, Mp4OutputFormat, Output, Quality, VideoSampleSink, WebMOutputFormat, type AudioCodec, type InputAudioTrack, type InputVideoTrack,
} from "mediabunny";
import { getBudget, type MediaAsset } from "../media-loader";
import { FilmRenderer } from "../render/renderer";
import type { RenderParams } from "../render/params";
import { exportName } from "./filename";
import type { ExportJob } from "./photo-export";
import { ExportCancelled } from "./worker-client";
import { recordViaMediaRecorder } from "./recorder-fallback";
import {
  audioPlan, estimateVideoBytes, fpsPlan, formatLine, has1080Option, NO_AUDIO, originalSize, pickContainerCodec, rotationToOrientation, video1080, videoBitrate, videoTooLarge,
  type AudioPlan, type CodecPick, type VideoCodecId,
} from "./video-plan";

export type VideoSizeChoice = "original" | "1080p";

export interface VideoVariant {
  width: number; height: number; bitrate: number; pick: CodecPick; audio: AudioPlan; estBytes: number; tooLarge: boolean; line: string;
}

export interface VideoPlanInfo {
  displayW: number; displayH: number; srcFps: number; fpsOut: number; resample: boolean; duration: number; t0: number;
  original: VideoVariant; p1080: VideoVariant | null; error: string | null;
}

const AUDIO_PROBE: AudioCodec[] = ["aac", "opus", "vorbis"];

async function audioCaps(at: InputAudioTrack, fmtSupports: AudioCodec[]) {
  const ch = await at.getNumberOfChannels();
  const sr = await at.getSampleRate();
  const canDecode = await at.canDecode();
  const enc = new Map<string, boolean>();
  for (const c of AUDIO_PROBE) enc.set(c, await canEncodeAudio(c, { numberOfChannels: ch, sampleRate: sr, quality: new Quality({ bitrate: 192000 }) }).catch(() => false));
  const hasCfg = (await at.getDecoderConfig()) !== null;
  return { canDecode, canEncode: (c: string) => enc.get(c) === true, containerSupports: (c: string) => (fmtSupports as string[]).includes(c), hasDecoderConfig: hasCfg };
}

async function variantFor(vt: InputVideoTrack, at: InputAudioTrack | null, width: number, height: number, fpsOut: number, duration: number, budget: number): Promise<VideoVariant> {
  const B = videoBitrate(width, height, fpsOut);
  const Q = new Quality({ bitrate: B, bitrateMode: "variable" });
  void vt;
  const pick = await pickContainerCodec({
    firstEncodable: async (c) => (await getFirstEncodableVideoCodec(c as VideoCodecId[], { width, height, quality: Q, frameRate: fpsOut })) as VideoCodecId | null,
    hasMediaRecorder: typeof MediaRecorder !== "undefined",
  });
  let audio: AudioPlan = NO_AUDIO;
  let srcAudioBitrate: number | null = null;
  if (at && (pick.container === "mp4" || pick.container === "webm")) {
    const fmt = pick.container === "mp4" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat();
    audio = audioPlan(pick.container, await at.getCodec(), await audioCaps(at, fmt.getSupportedAudioCodecs()));
    srcAudioBitrate = await at.getBitrate();
  }
  const estBytes = estimateVideoBytes(B, audio, srcAudioBitrate, duration);
  return { width, height, bitrate: B, pick, audio, estBytes, tooLarge: videoTooLarge(estBytes, budget), line: formatLine(pick, audio) };
}

/** 모달을 열 때 한 번: 크기·fps·코덱·오디오 계획과 예상 용량 */
export async function planVideo(file: Blob): Promise<VideoPlanInfo> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) throw new Error("영상 트랙을 찾지 못했습니다 — 다른 파일로 다시 시도하세요");
    const at = await input.getPrimaryAudioTrack();
    const dw = await vt.getDisplayWidth(), dh = await vt.getDisplayHeight();
    const m = await vt.computeFrameRateMetrics();
    const src = m.underlyingFrameRate ?? m.bestGuessFrameRate;
    const { fpsOut, resample } = fpsPlan(src);
    const t0 = await input.getFirstTimestamp();
    const duration = (await input.computeDuration()) - t0;
    const budget = getBudget().budgetBytes;
    const o = originalSize(dw, dh);
    const original = await variantFor(vt, at, o.width, o.height, fpsOut, duration, budget);
    const s = video1080(dw, dh);
    const p1080 = has1080Option(dw, dh) ? await variantFor(vt, at, s.width, s.height, fpsOut, duration, budget) : null;
    return { displayW: dw, displayH: dh, srcFps: src, fpsOut, resample, duration, t0, original, p1080, error: null };
  } finally {
    input.dispose();
  }
}

export interface VideoResult { blob: Blob; file: File; width: number; height: number; bytes: number; warnings: string[]; mime: string; ext: "mp4" | "webm" }

interface VideoArgs {
  file: File; asset: MediaAsset; params: RenderParams; variant: VideoVariant; plan: VideoPlanInfo; simId: string | null; job: ExportJob; start: Date;
  onProgress(p: number): void;
}

/** 내보내기 전용 렌더러 (DOM 에 붙이지 않는다) */
async function makeRenderer(a: VideoArgs): Promise<{ renderer: FilmRenderer; canvas: HTMLCanvasElement }> {
  const canvas = document.createElement("canvas");
  canvas.width = a.variant.width;
  canvas.height = a.variant.height;
  const renderer = FilmRenderer.create(canvas, { preserveDrawingBuffer: true });
  renderer.setParams(a.params);
  await renderer.whenReady();
  await renderer.setExportVideo(a.asset, { width: a.variant.width, height: a.variant.height });
  return { renderer, canvas };
}

function disposeRenderer(r: FilmRenderer, canvas: HTMLCanvasElement): void {
  r.dispose();
  const gl = canvas.getContext("webgl2");
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
}

export async function exportVideo(a: VideoArgs): Promise<VideoResult> {
  const { variant: v } = a;
  if (v.pick.container === "none") throw new Error("이 기기는 동영상 인코딩을 지원하지 않습니다");
  const wake = await (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock?.request("screen").catch(() => null);
  try {
    if (v.pick.container === "recorder") return await recordViaMediaRecorder({ ...a });
    return await highSpeed(a);
  } finally {
    void wake?.release();
  }
}

async function highSpeed(a: VideoArgs): Promise<VideoResult> {
  const { variant: v, plan, job } = a;
  const check = () => { if (job.cancelled) throw new ExportCancelled(); };
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(a.file) });
  let rend: { renderer: FilmRenderer; canvas: HTMLCanvasElement } | null = null;
  let output: Output | null = null;
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) throw new Error("영상 트랙을 찾지 못했습니다 — 다른 파일로 다시 시도하세요");
    const at = await input.getPrimaryAudioTrack();
    const orient = rotationToOrientation(await vt.getRotation(), await vt.getFlip());
    const t0 = await input.getFirstTimestamp();
    const tEnd = await input.computeDuration();
    const span = Math.max(1e-6, tEnd - t0);
    rend = await makeRenderer(a);
    const { renderer, canvas } = rend;
    const mp4 = v.pick.container === "mp4";
    const fmt = mp4 ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat();
    output = new Output({ format: fmt, target: new BufferTarget() });
    const Q = new Quality({ bitrate: v.bitrate, bitrateMode: "variable" });
    const vsrc = new CanvasSource(canvas, { codec: v.pick.codec!, quality: Q, keyFrameInterval: 2 });
    output.addVideoTrack(vsrc, plan.resample ? { frameRate: 60 } : {});
    let acopy: EncodedAudioPacketSource | null = null;
    let atrans: AudioSampleSource | null = null;
    const ac = at ? await at.getCodec() : null;
    if (at && v.audio.mode === "copy" && ac) { acopy = new EncodedAudioPacketSource(ac); output.addAudioTrack(acopy); }
    else if (at && v.audio.mode === "transcode" && v.audio.codec) { atrans = new AudioSampleSource({ codec: v.audio.codec as AudioCodec, quality: new Quality({ bitrate: 192000 }) }); output.addAudioTrack(atrans); }
    try { output.setMetadataTags(await input.getMetadataTags()); } catch (e) { console.warn("메타데이터 태그를 복사하지 못했습니다", e); }
    await output.start();

    const sink = new VideoSampleSink(vt);
    const fpsOut = plan.fpsOut;
    const videoPump = async () => {
      if (!plan.resample) {
        for await (const s of sink.samples()) {
          check();
          const frame = s.toVideoFrame();
          try { await renderer.renderExportFrame(frame, orient, Math.round((s.timestamp - t0) * fpsOut)); } finally { frame.close(); }
          await vsrc.add(s.timestamp - t0, s.duration);
          const end = s.timestamp + s.duration;
          s.close();
          a.onProgress(Math.min(1, Math.max(0, (end - t0) / span)));
        }
      } else {
        async function* grid() { for (let k = 0; t0 + k / 60 < tEnd; k++) yield t0 + k / 60; }
        let k = 0;
        for await (const s of sink.samplesAtTimestamps(grid())) {
          check();
          const tk = t0 + k / 60;
          k++;
          if (!s) continue;
          const frame = s.toVideoFrame();
          try { await renderer.renderExportFrame(frame, orient, Math.round((tk - t0) * 60)); } finally { frame.close(); }
          await vsrc.add(tk - t0, 1 / 60);
          s.close();
          a.onProgress(Math.min(1, Math.max(0, (tk + 1 / 60 - t0) / span)));
        }
      }
      vsrc.close();
    };
    const audioPump = async () => {
      if (at && acopy) {
        const dc = await at.getDecoderConfig();
        let first = true;
        for await (const p of new EncodedPacketSink(at).packets()) {
          check();
          const q = t0 === 0 ? p : p.clone({ timestamp: p.timestamp - t0 });
          await acopy.add(q, first && dc ? { decoderConfig: dc } : undefined);
          first = false;
        }
        acopy.close();
      } else if (at && atrans) {
        for await (const s of new AudioSampleSink(at).samples()) {
          check();
          s.setTimestamp(s.timestamp - t0);
          await atrans.add(s);
          s.close();
        }
        atrans.close();
      }
    };
    await Promise.all([videoPump(), audioPump()]);
    check();
    await output.finalize();
    const buf = (output.target as BufferTarget).buffer;
    if (!buf) throw new Error("인코딩 결과가 비어 있습니다 — 다시 시도하세요");
    const mime = mp4 ? "video/mp4" : "video/webm";
    const ext = mp4 ? "mp4" : "webm";
    const blob = new Blob([buf], { type: mime });
    const file = new File([blob], exportName(a.asset.fileName, a.simId, a.start, ext), { type: mime });
    return { blob, file, width: v.width, height: v.height, bytes: blob.size, warnings: v.audio.warning ? [v.audio.warning] : [], mime, ext };
  } catch (e) {
    if (output) await output.cancel().catch(() => undefined);
    throw e;
  } finally {
    input.dispose();
    if (rend) disposeRenderer(rend.renderer, rend.canvas);
  }
}

export type { VideoArgs };

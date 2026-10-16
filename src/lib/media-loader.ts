// 미디어 로더 파사드 (CLAUDE.md §2-10). UI 는 src/lib/media/* 를 직접 import 하지 않고 이 파일만 쓴다.
import { getBudget } from "./media/budget";
import type { LoadStage, MediaAsset, PixelBufferF32, SourcePrimaries, SourceProfileId } from "./media/types";
import type { Request, Response, WorkerAsset } from "./media/rpc";

export type { LoadStage, MediaAsset, MediaKind, PixelBufferF32, SourceFormat, SourceDescriptor, SourcePrimaries, SourceProfileId, VideoInfo, LogDetection, HistogramStats } from "./media/types";
export { SUPPORTED_EXTENSIONS } from "./media/errors";
export { getBudget } from "./media/budget";
export { PROFILE_TABLE } from "./media/log-detect";

export interface LoadCallbacks {
  onPreview?(p: { bitmap: ImageBitmap; width: number; height: number }): void;
  onProgress?(stage: LoadStage, message: string): void;
}

/** 워커/로더가 던지는 오류. code 는 docs/MEDIA_PIPELINE.md §14.3 */
export class MediaLoadError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MediaLoadError";
    this.code = code;
  }
}

interface Pending {
  resolve(r: Response): void;
  reject(e: Error): void;
  cb?: LoadCallbacks;
  file?: File;
  /** 실패 시 돌려받은 proxy 버퍼를 자산에 복구 */
  restoreProxy?(p: { width: number; height: number; data: ArrayBuffer }): void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
const assets = new Map<string, MediaAsset>();
let activeId: string | null = null;
/** 자산별 직렬화: proxy 버퍼를 워커와 주고받는 동안 다른 호출이 끼어들지 못하게 한다 */
let opChain: Promise<unknown> = Promise.resolve();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("../workers/media-decode.worker.ts", import.meta.url), { type: "module" });
  w.onmessage = (e: MessageEvent<Response>) => onMessage(e.data);
  w.onerror = (e) => {
    const err = new MediaLoadError("DECODE_FAILED", `워커 오류: ${e.message || "알 수 없음"} — 페이지를 새로고침한 뒤 다시 시도하세요.`);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker = null;
  };
  worker = w;
  return w;
}

function send(m: Request, transfer: Transferable[] = []): void {
  getWorker().postMessage(m, transfer);
}

function request(build: (id: number) => { msg: Request; transfer?: Transferable[] }, extra: Partial<Pending> = {}): Promise<Response> {
  const id = nextId++;
  return new Promise<Response>((resolve, reject) => {
    pending.set(id, { resolve, reject, ...extra });
    const { msg, transfer } = build(id);
    send(msg, transfer ?? []);
  });
}

function onMessage(m: Response): void {
  const p = pending.get(m.id);
  if (!p) return;
  switch (m.type) {
    case "progress": p.cb?.onProgress?.(m.stage, m.message); return;
    case "preview": p.cb?.onPreview?.({ bitmap: m.bitmap, width: m.width, height: m.height }); return;
    case "needs-main-heic": void mainHeic(m.id, p); return;
    case "needs-main-raw": void mainRaw(m.id, m.halfSize, p); return;
    case "needs-main-video-frame": void mainVideoFrame(m.id, p); return;
    case "error": pending.delete(m.id); if (m.proxy) p.restoreProxy?.(m.proxy); p.reject(new MediaLoadError(m.code, m.message)); return;
    default: pending.delete(m.id); p.resolve(m);
  }
}

// ── 메인 스레드 폴백 ────────────────────────────────────────────────────────
async function mainHeic(id: number, p: Pending): Promise<void> {
  try {
    // heic2any 는 DOM canvas 를 쓰므로 메인 전용. 동적 import 로 별도 청크에 둔다 (CLAUDE.md §2-6 / spec §3-6)
    const { default: heic2any } = await import("heic2any");
    const out = await heic2any({ blob: p.file as Blob, toType: "image/png" });
    const blob = Array.isArray(out) ? out[0]! : out;
    const png = await blob.arrayBuffer();
    send({ id, op: "heic-png", ok: true, png }, [png]);
  } catch (e) {
    send({ id, op: "heic-png", ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

async function mainRaw(id: number, halfSize: boolean, p: Pending): Promise<void> {
  try {
    const { decodeRaw } = await import("./media/raw-decode");
    const r = await decodeRaw(p.file as Blob, halfSize);
    send({ id, op: "raw-pixels", ok: true, width: r.pixels.width, height: r.pixels.height, colors: r.pixels.colors, data: r.pixels.data, meta: r.meta }, [r.pixels.data.buffer]);
  } catch (e) {
    send({ id, op: "raw-pixels", ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

async function mainVideoFrame(id: number, p: Pending): Promise<void> {
  const url = URL.createObjectURL(p.file as Blob);
  const v = document.createElement("video");
  try {
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = url;
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error("loadeddata 시간 초과(10초)")), 10000);
      v.onloadeddata = () => { clearTimeout(t); res(); };
      v.onerror = () => { clearTimeout(t); rej(new Error(v.error?.message || "video 오류")); };
    });
    await new Promise<void>((res) => {
      v.onseeked = () => res();
      v.currentTime = 0;
      setTimeout(res, 2000);
    });
    const bitmap = await createImageBitmap(v);
    send({ id, op: "video-frame-bitmap", ok: true, bitmap }, [bitmap]);
  } catch (e) {
    send({ id, op: "video-frame-bitmap", ok: false, error: e instanceof Error ? e.message : String(e) });
  } finally {
    v.removeAttribute("src");
    v.load();
    URL.revokeObjectURL(url);
  }
}

// ── 공개 API ───────────────────────────────────────────────────────────────
function fromWorker(a: WorkerAsset): MediaAsset {
  return { ...a, proxy: { width: a.proxy.width, height: a.proxy.height, data: new Float32Array(a.proxy.data) } };
}

export async function loadMedia(file: File, cb?: LoadCallbacks): Promise<MediaAsset> {
  if (activeId) disposeMedia(activeId);
  const r = await request((id) => ({ msg: { id, op: "load", file, budget: getBudget(), crossOriginIsolated: globalThis.crossOriginIsolated === true } }), { cb, file });
  if (r.type !== "result") throw new MediaLoadError("DECODE_FAILED", "예상하지 못한 워커 응답입니다");
  const asset = fromWorker(r.asset);
  assets.set(asset.id, asset);
  activeId = asset.id;
  return asset;
}

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const p = opChain.then(fn, fn);
  opChain = p.catch(() => undefined);
  return p;
}

export function getFullResolutionTile(assetId: string, rect: { x: number; y: number; width: number; height: number }): Promise<PixelBufferF32> {
  return serialized(async () => {
    const r = await request((id) => ({ msg: { id, op: "tile", assetId, rect } }));
    if (r.type !== "tile-result") throw new MediaLoadError("DECODE_FAILED", "예상하지 못한 워커 응답입니다");
    return { width: r.width, height: r.height, data: new Float32Array(r.data) };
  });
}

export function setSourceProfile(assetId: string, profile: SourceProfileId, primaries?: SourcePrimaries): Promise<MediaAsset> {
  return serialized(async () => {
    const cur = assets.get(assetId);
    if (!cur) throw new MediaLoadError("DECODE_FAILED", "이미 해제된 자산입니다 — 파일을 다시 여세요.");
    const r = await request((id) => ({ msg: { id, op: "set-profile", assetId, profile, primaries } }));
    if (r.type !== "profile-result") throw new MediaLoadError("DECODE_FAILED", "예상하지 못한 워커 응답입니다");
    const next: MediaAsset = { ...cur, descriptor: r.descriptor, detection: r.detection, warnings: r.warnings };
    assets.set(assetId, next);
    return next;
  });
}

export function renderOriginalPreview(assetId: string, maxLongEdge: number): Promise<ImageBitmap> {
  return serialized(async () => {
    const a = assets.get(assetId);
    if (!a) throw new MediaLoadError("DECODE_FAILED", "이미 해제된 자산입니다 — 파일을 다시 여세요.");
    const buf = a.proxy.data.buffer as ArrayBuffer;
    const proxy = { width: a.proxy.width, height: a.proxy.height, data: buf };
    // proxy 버퍼는 transfer 로 왕복한다 (복사본을 두지 않기 위해)
    const restore = (p: { width: number; height: number; data: ArrayBuffer }) => { a.proxy = { width: p.width, height: p.height, data: new Float32Array(p.data) }; };
    const r = await request((id) => ({ msg: { id, op: "render-original", assetId, maxLongEdge, proxy }, transfer: [buf] }), { restoreProxy: restore });
    if (r.type !== "render-result") throw new MediaLoadError("DECODE_FAILED", "예상하지 못한 워커 응답입니다");
    a.proxy = { width: r.proxy.width, height: r.proxy.height, data: new Float32Array(r.proxy.data) };
    return r.bitmap;
  });
}

export function disposeMedia(assetId: string): void {
  assets.delete(assetId);
  if (activeId === assetId) activeId = null;
  if (worker) send({ id: nextId++, op: "dispose", assetId });
}

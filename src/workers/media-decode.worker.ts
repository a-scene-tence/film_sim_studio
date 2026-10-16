/// 통합 미디어 디코드 워커 (docs/MEDIA_PIPELINE.md §14). 디코딩·파싱·EXIF 는 전부 여기서 처리한다.
import { extractExif, type ExifExtraction } from "../lib/exif-manager";
import { toWorkingSpaceBuffer } from "../lib/color/source/normalize.mjs";
import { srgbEnc, tone } from "../lib/color/fse/engine.mjs";
import { getLut, listLuts } from "../lib/lut/lutStore";
import type { Budget } from "../lib/media/budget";
import { rawFullFits } from "../lib/media/budget";
import { warnings as W, errors, toErrorInfo } from "../lib/media/errors";
import { buildHeicPrimaries } from "../lib/media/heic-primaries";
import { decodePng16, decodeToRgba8, imageDescriptor, proxyFromRgba8, supportsP3Canvas } from "../lib/media/image-decode";
import { readSof, stripApp1 } from "../lib/media/jpeg";
import { defaultPrimaries, detectLog, requiresSourceLut } from "../lib/media/log-detect";
import { displayRectToSource, flipToOrientation, orientedSize, outputToSource } from "../lib/media/orientation";
import { isExifChunk, pngHeader, stripPngChunks } from "../lib/media/png-chunks";
import { computeKRaw, decodeRaw, type RawDecodeResult, type RawPixels } from "../lib/media/raw-decode";
import { decodeRawPreviewBitmap, findRawPreview } from "../lib/media/raw-preview";
import { stripWebpExif, webpSize } from "../lib/media/riff";
import { heicDisplaySize } from "../lib/media/heic";
import { kindOf, sniffFormat } from "../lib/media/sniff";
import { proxySize, resampleArray, resampleRows } from "../lib/media/resample";
import type { LoadStage, LogDetection, MediaAsset, PixelBufferF32, SourceDescriptor, SourceFormat, SourcePrimaries, SourceProfileId } from "../lib/media/types";
import { frameFromBitmap, webCodecsFirstFrame, type FirstFrame } from "../lib/media/video-frame";
import { playback4k60, probeVideo, type ProbeResult } from "../lib/media/video-probe";
import type { Request, Response, WorkerAsset } from "../lib/media/rpc";

interface Scope { postMessage(m: unknown, t?: Transferable[]): void; onmessage: ((e: MessageEvent<Request>) => void) | null }
const scope = self as unknown as Scope;

interface Active {
  id: string; kind: "raw" | "image" | "video"; format: SourceFormat; file: File;
  /** 이미지 타일용: 디코드에 쓴 EXIF 제거 Blob (16bit PNG 는 null) */
  decodeBlob: Blob | null; png16: boolean;
  /** 타일 디코드에 쓰는 캔버스 색공간 (프록시와 같아야 한다) */
  tileColorSpace: "srgb" | "display-p3";
  orientation: number; origW: number; origH: number;
  descriptor: SourceDescriptor; detection: LogDetection | null; warnings: string[];
  budget: Budget; rawFull: RawPixels | null;
}
let active: Active | null = null;
let nextAsset = 1;

function post(m: Response, t: Transferable[] = []): void { scope.postMessage(m, t); }

// ── 메인이 보내는 후속 메시지를 기다리는 장치 ───────────────────────────────
const waiters = new Map<string, (m: Request) => void>();
function waitFor<T extends Request["op"]>(id: number, op: T): Promise<Extract<Request, { op: T }>> {
  return new Promise((res) => waiters.set(`${id}:${op}`, res as (m: Request) => void));
}

// ── 큐: load/tile/... 는 순차 처리 ────────────────────────────────────────
let chain: Promise<void> = Promise.resolve();
scope.onmessage = (e) => {
  const m = e.data;
  if (m.op === "heic-png" || m.op === "raw-pixels" || m.op === "video-frame-bitmap") {
    const w = waiters.get(`${m.id}:${m.op}`);
    if (w) { waiters.delete(`${m.id}:${m.op}`); w(m); }
    return;
  }
  chain = chain.then(() => handle(m)).catch(() => undefined);
};

async function handle(m: Request): Promise<void> {
  try {
    switch (m.op) {
      case "load": return await load(m.id, m.file, m.budget, m.crossOriginIsolated);
      case "tile": return await tile(m.id, m.assetId, m.rect);
      case "set-profile": return await setProfile(m.id, m.assetId, m.profile, m.primaries);
      case "render-original": return await renderOriginal(m.id, m.assetId, m.maxLongEdge, m.proxy);
      case "dispose": release(); post({ id: m.id, type: "disposed" }); return;
      default: return;
    }
  } catch (e) {
    const info = toErrorInfo(e);
    // render-original 이 실패해도 왕복 중인 proxy 버퍼는 메인에 돌려준다
    if (m.op === "render-original") post({ id: m.id, type: "error", code: info.code, message: info.message, proxy: m.proxy }, [m.proxy.data]);
    else post({ id: m.id, type: "error", code: info.code, message: info.message });
  }
}

function release(): void {
  active = null;
}

const progress = (id: number, stage: LoadStage, message: string) => post({ id, type: "progress", stage, message });

// ── load ─────────────────────────────────────────────────────────────────
async function load(id: number, file: File, budget: Budget, coi: boolean): Promise<void> {
  release();
  progress(id, "sniff", "형식 판별");
  const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  const format = sniffFormat(head, file.name);
  const kind = kindOf(format);
  const base = { id: `asset-${nextAsset++}`, kind, format, fileName: file.name, byteSize: file.size };
  let asset: Omit<MediaAsset, "proxy"> & { proxy: PixelBufferF32 };
  if (kind === "image") asset = await loadImage(id, file, format, base, budget);
  else if (kind === "raw") asset = await loadRaw(id, file, format, base, budget, coi);
  else asset = await loadVideo(id, file, format, base, budget);
  progress(id, "done", "완료");
  const wa: WorkerAsset = { ...asset, proxy: { width: asset.proxy.width, height: asset.proxy.height, data: asset.proxy.data.buffer as ArrayBuffer } };
  post({ id, type: "result", asset: wa }, [wa.proxy.data]);
}

type BaseInfo = { id: string; kind: "raw" | "image" | "video"; format: SourceFormat; fileName: string; byteSize: number };

function setExifSize(exif: ExifExtraction, size: { width: number; height: number }): void {
  exif.summary.originalSize = `${size.width}×${size.height}`;
}

// 이미지 ───────────────────────────────────────────────────────────────────
async function loadImage(id: number, file: File, format: SourceFormat, base: BaseInfo, budget: Budget) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  progress(id, "metadata", "EXIF 읽는 중");
  const exif = await extractExif(bytes, format, { byteSize: file.size, lastModified: file.lastModified });
  const warnings: string[] = [];
  let orientation = format === "heic" ? 1 : exif.payload.orientation;
  if (orientation < 1 || orientation > 8) orientation = 1;
  progress(id, "decode", "디코드 중");

  let proxy: PixelBufferF32;
  let primaries: SourcePrimaries;
  let origW: number, origH: number;
  let strategy = "browser";
  let blob: Blob | null = null;
  let bitDepth = 8;
  let png16 = false;

  if (format === "png" && (pngHeader(bytes)?.bitDepth ?? 8) === 16) {
    const r = decodePng16(bytes, orientation, budget.budgetBytes);
    proxy = r.proxy; primaries = r.primaries; origW = r.width; origH = r.height; warnings.push(...r.warn);
    strategy = "fast-png-16"; bitDepth = 16; png16 = true;
  } else {
    let decodeBytes: Uint8Array = bytes;
    let dims: { width: number; height: number } | null = null;
    let mime = "image/png";
    if (format === "jpeg") { decodeBytes = stripApp1(bytes); dims = readSof(decodeBytes); mime = "image/jpeg"; }
    else if (format === "png") { decodeBytes = stripPngChunks(bytes, (c) => isExifChunk(c)); const h = pngHeader(bytes); dims = h ? { width: h.width, height: h.height } : null; }
    else if (format === "webp") { decodeBytes = stripWebpExif(bytes); dims = webpSize(decodeBytes); mime = "image/webp"; }
    else if (format === "heic") { dims = heicDisplaySize(bytes); mime = "image/heic"; }
    blob = new Blob([decodeBytes as BlobPart], { type: mime });
    let rgba: Awaited<ReturnType<typeof decodeToRgba8>> | null = null;
    let heicPrimaries: SourcePrimaries | null = null;
    try {
      rgba = await decodeToRgba8(blob, dims?.width ?? null, dims?.height ?? null, budget.budgetBytes);
      if (format === "heic") strategy = "heic-native";
    } catch (e) {
      if (format !== "heic") throw errors.decodeFailed(e instanceof Error ? e.message : String(e));
      // 8.5-2~4 메인 스레드 heic2any 폴백
      post({ id, type: "needs-main-heic" });
      const r = await waitFor(id, "heic-png");
      if (!r.ok || !r.png) throw errors.decodeFailed(r.error ?? "HEIC 변환 실패");
      const pngBytes = new Uint8Array(r.png);
      const { decode } = await import("fast-png");
      const png = decode(pngBytes);
      const ch = png.channels;
      const px = new Uint8ClampedArray(png.width * png.height * 4);
      const src = png.data as Uint8Array;
      for (let i = 0, n = png.width * png.height; i < n; i++) {
        px[i * 4] = src[i * ch]!; px[i * 4 + 1] = src[i * ch + (ch >= 3 ? 1 : 0)]!; px[i * 4 + 2] = src[i * ch + (ch >= 3 ? 2 : 0)]!; px[i * 4 + 3] = 255;
      }
      rgba = { data: px, width: png.width, height: png.height, primaries: "srgb", reduced: false };
      heicPrimaries = buildHeicPrimaries(bytes);
      blob = new Blob([pngBytes as BlobPart], { type: "image/png" });
      strategy = "heic2any";
    }
    primaries = heicPrimaries ?? rgba.primaries;
    origW = dims?.width ?? rgba.width;
    origH = dims?.height ?? rgba.height;
    if (rgba.reduced) { strategy = "reduced-4096"; warnings.push(W.reducedDecode(origW, origH)); }
    progress(id, "proxy", "프록시 생성");
    proxy = proxyFromRgba8(rgba, orientation);
  }
  const displaySize = orientedSize(orientation, origW, origH);
  setExifSize(exif, displaySize);
  active = {
    id: base.id, kind: "image", format, file, decodeBlob: blob, png16, tileColorSpace: strategy === "heic2any" || png16 ? "srgb" : supportsP3Canvas() ? "display-p3" : "srgb", orientation, origW, origH,
    descriptor: imageDescriptor(primaries, bitDepth), detection: null, warnings, budget, rawFull: null,
  };
  return {
    ...base, displaySize, orientation, descriptor: active.descriptor, proxy, previewOnly: false, video: null, detection: null, histogram: null,
    exif, decodeStrategy: strategy, warnings,
  };
}

// RAW ──────────────────────────────────────────────────────────────────────
async function loadRaw(id: number, file: File, format: SourceFormat, base: BaseInfo, budget: Budget, coi: boolean) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  progress(id, "metadata", "EXIF 읽는 중");
  let exif = await extractExif(bytes, format, { byteSize: file.size, lastModified: file.lastModified });
  let orientation = exif.payload.orientation >= 1 && exif.payload.orientation <= 8 ? exif.payload.orientation : 1;

  progress(id, "preview", "내장 프리뷰 추출");
  const prev = findRawPreview(bytes);
  if (prev) {
    try {
      const bmp = await decodeRawPreviewBitmap(prev, orientation);
      post({ id, type: "preview", bitmap: bmp, width: bmp.width, height: bmp.height }, [bmp]);
    } catch { /* 프리뷰 실패는 치명적이지 않음 */ }
  }

  progress(id, "decode", "RAW 현상 중");
  const warnings: string[] = [];
  let decoded: RawDecodeResult | null = null;
  let failure = "";
  try {
    if (!coi) throw errors.notCrossOriginIsolated();
    decoded = await decodeRawAnywhere(id, file, true);
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  }

  if (!decoded) {
    // 9.3 실패 처리: 프리뷰 JPEG 를 8.2 경로로 디코드해 proxy 로 쓴다
    if (!prev) throw errors.decodeFailed(`RAW 현상 실패, 내장 프리뷰도 없음: ${failure}`);
    warnings.push(W.rawPreviewOnly);
    const blob = new Blob([prev.jpeg as BlobPart], { type: "image/jpeg" });
    const rgba = await decodeToRgba8(blob, prev.width, prev.height, budget.budgetBytes);
    const proxy = proxyFromRgba8(rgba, orientation);
    const displaySize = orientedSize(orientation, prev.width, prev.height);
    setExifSize(exif, displaySize);
    const descriptor = imageDescriptor(rgba.primaries);
    active = { id: base.id, kind: "raw", format, file, decodeBlob: null, png16: false, tileColorSpace: "srgb", orientation, origW: prev.width, origH: prev.height, descriptor, detection: null, warnings, budget, rawFull: null };
    return { ...base, displaySize, orientation, descriptor, proxy, previewOnly: true, video: null, detection: null, histogram: null, exif, decodeStrategy: "raw-preview-jpeg", warnings };
  }

  const { pixels, meta } = decoded;
  // 방향: metadata.flip 기준으로 통일
  const mapped = flipToOrientation(meta.flip ?? 0);
  if (mapped === null) { warnings.push(`알 수 없는 LibRaw flip=${meta.flip} — 방향 1 로 처리`); orientation = 1; }
  else if (mapped !== orientation) { warnings.push(W.orientationMismatch(orientation, mapped)); orientation = mapped; }
  const kRaw = computeKRaw(meta, format === "dng");
  progress(id, "proxy", "프록시 생성");
  const proxy = rawProxy(pixels, orientation);
  // LibRaw metadata.width/height 는 flip≥5 일 때 이미 가로·세로가 바뀐 값이다 (픽셀은 userFlip:0 이라 회전 전).
  // 픽셀 가로세로 비율과 어긋나면 되돌려 "회전 전 풀 크기"를 만든 뒤 방향을 반영한다.
  const mw = meta.width || pixels.width * 2, mh = meta.height || pixels.height * 2;
  const swapped = mw !== mh && pixels.width !== pixels.height && (pixels.width > pixels.height) !== (mw > mh);
  const fullW = swapped ? mh : mw, fullH = swapped ? mw : mh;
  const displaySize = orientedSize(orientation, fullW, fullH);
  exif = await extractExif(bytes, format, { byteSize: file.size, lastModified: file.lastModified, displaySize, libraw: { lens: meta.lens ?? null, timestamp: meta.timestamp ?? null } });
  const descriptor: SourceDescriptor = { profile: "raw-linear", primaries: "srgb", range: "full", bitDepth: 16, rawScale: kRaw };
  active = { id: base.id, kind: "raw", format, file, decodeBlob: null, png16: false, tileColorSpace: "srgb", orientation, origW: fullW, origH: fullH, descriptor, detection: null, warnings, budget, rawFull: null };
  return { ...base, displaySize, orientation, descriptor, proxy, previewOnly: false, video: null, detection: null, histogram: null, exif, decodeStrategy: "libraw-half", warnings };
}

/** 9.2 LibRaw 인스턴스 위치: 워커 안(중첩 워커) 또는 메인 */
async function decodeRawAnywhere(id: number, file: File, halfSize: boolean): Promise<RawDecodeResult> {
  if (typeof Worker === "function") return decodeRaw(file, halfSize);
  post({ id, type: "needs-main-raw", halfSize });
  const r = await waitFor(id, "raw-pixels");
  if (!r.ok || !r.data || !r.width || !r.height) throw errors.decodeFailed(r.error ?? "메인 스레드 RAW 현상 실패");
  return { pixels: { width: r.width, height: r.height, colors: r.colors ?? 3, data: r.data }, meta: r.meta as RawDecodeResult["meta"] };
}

/** 9.4 Uint16 RGB → Float32 RGBA, 방향 적용, 장축 ≤ 2048 (선형 평균) */
function rawProxy(p: RawPixels, orientation: number): PixelBufferF32 {
  const o = orientedSize(orientation, p.width, p.height);
  const { width: w, height: h } = proxySize(o.width, o.height);
  const data = resampleRows(o.width, o.height, w, h, "linear", (yp, row) => {
    for (let xp = 0; xp < o.width; xp++) {
      const [sx, sy] = outputToSource(orientation, p.width, p.height, xp, yp);
      const i = (sy * p.width + sx) * 3;
      row[xp * 3] = p.data[i]! / 65535; row[xp * 3 + 1] = p.data[i + 1]! / 65535; row[xp * 3 + 2] = p.data[i + 2]! / 65535;
    }
  });
  return { width: w, height: h, data };
}

// 비디오 ───────────────────────────────────────────────────────────────────
async function sourceLutFor(profile: SourceProfileId): Promise<{ size: number; data: Float32Array } | null> {
  if (!requiresSourceLut(profile)) return null;
  const want = profile === "samsunglog" ? "samsung-log" : "dji-dlog-m";
  try {
    const m = (await listLuts()).find((l) => l.role === "source-transform" && l.sourceProfile === want);
    const l = m && (await getLut(m.id));
    return l ? { size: l.size, data: l.data } : null;
  } catch {
    return null;
  }
}

async function loadVideo(id: number, file: File, format: SourceFormat, base: BaseInfo, budget: Budget) {
  progress(id, "metadata", "동영상 메타데이터 읽는 중");
  const probe: ProbeResult = await probeVideo(file, format as "mp4" | "mov" | "webm");
  const info = probe.info;
  info.playback4k60 = await playback4k60(info);
  progress(id, "decode", "첫 프레임 디코드");
  let frame: FirstFrame | null = await webCodecsFirstFrame(file, info, probe.config, probe.firstSample);
  let strategy = "video-webcodecs";
  if (!frame) {
    strategy = "video-element";
    post({ id, type: "needs-main-video-frame" });
    const r = await waitFor(id, "video-frame-bitmap");
    if (!r.ok || !r.bitmap) throw errors.unsupportedCodec(info.codec);
    frame = frameFromBitmap(r.bitmap);
    r.bitmap.close();
  }
  progress(id, "analyze", "Log 감지");
  const detection = detectLog({ colour: info.colour, fileName: file.name, metaText: probe.metaText, make: info.make, histogram: frame.stats });
  const warnings: string[] = [W.videoThumbnailApprox];
  if (detection.requiresSourceLut && !(await sourceLutFor(detection.profile))) warnings.push(W.sourceLutRequired);
  const applied = detection.autoApply ? detection.profile : "rec709";
  const descriptor: SourceDescriptor = {
    profile: applied, primaries: applied === "rec709" ? "srgb" : detection.autoApply ? detection.primaries : "srgb",
    range: info.colour.fullRange ? "full" : "limited", bitDepth: info.bitDepth, rawScale: null,
  };
  active = { id: base.id, kind: "video", format, file, decodeBlob: null, png16: false, tileColorSpace: "srgb", orientation: 1, origW: info.width, origH: info.height, descriptor, detection, warnings, budget, rawFull: null };
  return {
    ...base, displaySize: { width: info.width, height: info.height }, orientation: 1, descriptor, proxy: frame.proxy, previewOnly: false, video: info,
    detection, histogram: frame.stats, exif: null, decodeStrategy: strategy, warnings,
  };
}

// set-profile ──────────────────────────────────────────────────────────────
async function setProfile(id: number, assetId: string, profile: SourceProfileId, primaries?: SourcePrimaries): Promise<void> {
  const a = need(assetId);
  if (profile === "pq") throw errors.pq();
  const prim: SourcePrimaries = primaries ?? (profile === "rec709" || profile === "srgb-image" ? (a.kind === "image" ? a.descriptor.primaries : "srgb") : defaultPrimaries(profile));
  a.descriptor = { ...a.descriptor, profile, primaries: prim };
  const warnings = a.warnings.filter((w) => w !== W.sourceLutRequired);
  if (requiresSourceLut(profile) && !(await sourceLutFor(profile))) warnings.push(W.sourceLutRequired);
  a.warnings = warnings;
  post({ id, type: "profile-result", descriptor: a.descriptor, detection: a.detection, warnings });
}

function need(assetId: string): Active {
  if (!active || active.id !== assetId) throw errors.decodeFailed("이미 해제된 자산입니다 — 파일을 다시 여세요");
  return active;
}

// render-original ──────────────────────────────────────────────────────────
async function renderOriginal(id: number, assetId: string, maxLongEdge: number, proxy: { width: number; height: number; data: ArrayBuffer }): Promise<void> {
  const a = need(assetId);
  const src = new Float32Array(proxy.data);
  const lut = await sourceLutFor(a.descriptor.profile);
  const ws = new Float32Array(src.length);
  toWorkingSpaceBuffer(src, ws, a.descriptor, lut ?? undefined);
  const { width: w, height: h } = proxySize(proxy.width, proxy.height, maxLongEdge);
  const small = w === proxy.width && h === proxy.height ? ws : resampleArray(ws, proxy.width, proxy.height, w, h, 4, "linear");
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) {
      const x = small[i * 4 + c]!;
      const v = srgbEnc(Math.min(1, Math.max(0, tone(x))));
      px[i * 4 + c] = Math.round(v * 255);
    }
    px[i * 4 + 3] = 255;
  }
  const bitmap = await createImageBitmap(new ImageData(px, w, h));
  post({ id, type: "render-result", bitmap, proxy }, [bitmap, proxy.data]);
}

// tile ─────────────────────────────────────────────────────────────────────
async function tile(id: number, assetId: string, rect: { x: number; y: number; width: number; height: number }): Promise<void> {
  const a = need(assetId);
  if (rect.width > 2048 || rect.height > 2048 || rect.width < 1 || rect.height < 1) throw errors.decodeFailed("타일은 1~2048 픽셀이어야 합니다");
  const o = a.orientation;
  const full = orientedSize(o, a.origW, a.origH);
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > full.width || rect.y + rect.height > full.height) throw errors.decodeFailed("타일 영역이 이미지 밖입니다");
  const s = displayRectToSource(o, a.origW, a.origH, rect);
  let rgba: Float32Array; // 원본 방향의 s.width × s.height RGBA (0~1)
  if (a.kind === "image") {
    if (a.png16) {
      const { decode } = await import("fast-png");
      const png = decode(new Uint8Array(await a.file.arrayBuffer()));
      const ch = png.channels, max = png.depth === 16 ? 65535 : 255, src = png.data as Uint16Array | Uint8Array;
      rgba = new Float32Array(s.width * s.height * 4);
      for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
        const i = ((s.y + y) * png.width + s.x + x) * ch, d = (y * s.width + x) * 4;
        rgba[d] = src[i]! / max; rgba[d + 1] = src[i + (ch >= 3 ? 1 : 0)]! / max; rgba[d + 2] = src[i + (ch >= 3 ? 2 : 0)]! / max; rgba[d + 3] = 1;
      }
    } else {
      if (!a.decodeBlob) throw errors.decodeFailed("타일을 만들 수 없는 자산입니다");
      const cs = a.tileColorSpace;
      const bmp = await createImageBitmap(a.decodeBlob, s.x, s.y, s.width, s.height, { premultiplyAlpha: "none", colorSpaceConversion: "default" });
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d", { colorSpace: cs, willReadFrequently: true })!;
      g.drawImage(bmp, 0, 0);
      const px = g.getImageData(0, 0, bmp.width, bmp.height, { colorSpace: cs }).data;
      bmp.close();
      rgba = new Float32Array(s.width * s.height * 4);
      for (let i = 0; i < rgba.length; i++) rgba[i] = (i & 3) === 3 ? 1 : px[i]! / 255;
    }
  } else if (a.kind === "raw") {
    if (!a.rawFull) {
      if (!rawFullFits(a.origW, a.origH, a.budget.budgetBytes)) throw errors.outOfMemory();
      const r = await decodeRawAnywhere(id, a.file, false);
      a.rawFull = r.pixels;
    }
    const f = a.rawFull;
    rgba = new Float32Array(s.width * s.height * 4);
    for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
      const i = ((s.y + y) * f.width + s.x + x) * 3, d = (y * s.width + x) * 4;
      rgba[d] = f.data[i]! / 65535; rgba[d + 1] = f.data[i + 1]! / 65535; rgba[d + 2] = f.data[i + 2]! / 65535; rgba[d + 3] = 1;
    }
  } else {
    throw errors.decodeFailed("동영상은 풀해상도 타일을 지원하지 않습니다 (Step 4)");
  }
  // 원본 방향 타일에 방향을 적용 (10.2 정방향)
  const out = new Float32Array(rect.width * rect.height * 4);
  for (let yp = 0; yp < rect.height; yp++) for (let xp = 0; xp < rect.width; xp++) {
    const [sx, sy] = outputToSource(o, s.width, s.height, xp, yp);
    const si = (sy * s.width + sx) * 4, di = (yp * rect.width + xp) * 4;
    out[di] = rgba[si]!; out[di + 1] = rgba[si + 1]!; out[di + 2] = rgba[si + 2]!; out[di + 3] = 1;
  }
  post({ id, type: "tile-result", width: rect.width, height: rect.height, data: out.buffer as ArrayBuffer }, [out.buffer as ArrayBuffer]);
}


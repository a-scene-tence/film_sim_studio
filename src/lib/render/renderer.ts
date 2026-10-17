// 섹션 13 렌더러 API — WebGL2 멀티패스 (사진 프록시·원본 타일, 비디오 실시간).
import { matrixToWS } from "../color/source/primaries.mjs";
import { resolveInputBinding, type InputBinding } from "./binding";
import { getFullResolutionTile, type MediaAsset, type SourceDescriptor } from "../media-loader";
import { displaySizeOf, orientationFromMatrix } from "../media/video-probe";
import { bakeCurve, curveOn, CURVE_N } from "./curve";
import { DEFAULT_ATM, type Vec3 } from "./dehaze-atm";
import { createLut3D, createTex2D, createContext, detectCaps, halfToFloat, renderErrors, renderWarnings, setUnpackState, type RendererCaps } from "./gl";
import { PASS_NAMES } from "./glsl";
import { RenderGraph, type ChainParams, type HistPixels, type LutUniforms, type NormalizeUniforms } from "./graph";
import { DOMAIN_INDEX, listStoreLuts, loadBuiltinLut, loadManifest, loadStoreLut, storeSourceProfile, type CpuLut, type LutManifest, type ManifestSim, type StoreLut } from "./luts";
import { DEFAULT_PARAMS, effectiveParams, scalarUniforms, toneOpsOn, type Effective, type RenderParams } from "./params";
import { ispUniforms, type IspUniforms } from "./isp";
import { grainCoarse, grainOffset, grainScaleFull, grainScalePreview, hdfPlan, mhPlan, scaledSize, tilePadding, graphSizes, type Size } from "./plan";
import { normalizePixel, pixelPipelineFromWs, type LutStageRef, type NormalizeCtx, type PixelCtx } from "./reference";
import { toneInvTable, TONE_INV_N } from "./tone-inv-table";
import { probeVideoOrientation, type OrientationProbeResult } from "./video-orientation-probe";
import { VideoSource, type VideoStats } from "./video-source";
import { p3Available, type OutputSpace } from "./output-space";
import { apply3, colMajor, IDENTITY3, inv3, wbMatrix, type Mat3 } from "./wb";

export type { RendererCaps } from "./gl";

const LOST_WARNING = "GPU 컨텍스트 손실 — 복구를 기다리는 중";
export interface RenderStats { passes: number; cpuMs: number; R: { width: number; height: number } }

/** 프로브 렌더 덮어쓰기: 공간 단계(HDF, 마이크로 할레이션, 디헤이즈, 베이스 톤·ZS·팝, 명료도, 선명도·ES)를 끄고 그레인 강도를 지정 */
export interface ProbeOverride { grainAmount: number }

interface GpuLut { cpu: CpuLut; tex: WebGLTexture; flags?: { inVR: boolean; outVR: boolean; min: Vec3; max: Vec3; domain: number; name: string } }

export interface RendererInfo {
  R: Size | null;
  A: Size | null;
  D: Size | null;
  profileIndex: number | null;
  orient: number;
  srcSize: Size | null;
  atm: Vec3;
  lutKey: string | null;
  sourceLutName: string | null;
  orientationProbe: OrientationProbeResult | null;
  chainVersion: number;
}

export class FilmRenderer {
  readonly caps: RendererCaps;
  readonly warnings: string[] = [];
  /** 렌더·상태 변화 알림 (UI 갱신용) */
  onStatus: (() => void) | null = null;
  onError: ((e: Error) => void) | null = null;

  private gl: WebGL2RenderingContext;
  private graph: RenderGraph;
  private lost = false;
  private asset: MediaAsset | null = null;
  private srcTex: WebGLTexture | null = null;
  private srcSize: Size | null = null;
  private srcOrient = 1;
  private videoSrc: VideoSource | null = null;
  private videoFmt: { internal: number; type: number } | null = null;
  private orientProbe: OrientationProbeResult | null = null;
  private frameIndex = 0;
  private params: RenderParams = DEFAULT_PARAMS;
  private manifest: LutManifest | null = null;
  private gpuLuts = new Map<string, GpuLut>();
  private lutKey: string | null = null;
  private sourceLut: GpuLut | null = null;
  private sourceLutMissing = false;
  private curveKey = "";
  private curveTex: WebGLTexture | null = null;
  private curveTable: Float32Array | null = null;
  private toneInvTex: WebGLTexture | null = null;
  private atm: Vec3 = DEFAULT_ATM;
  private atmSig = "";
  private atmPending: { buf: WebGLBuffer; sync: WebGLSync; w: number; h: number; half: boolean } | null = null;
  private atmFrames = 0;
  private atmVideoSig = "";
  private lastChainSig = "";
  private chainVersion = 0;
  private rafPending = false;
  private resourceSeq = 0;
  private ready: Promise<void> = Promise.resolve();
  private lastR: Size | null = null;
  private disposed = false;
  /** Step 4: 내보내기 전용 고정 렌더 크기 (설정되면 R = fixedR, <video> 없이 VideoFrame 을 직접 업로드) */
  private fixedR: Size | null = null;
  private frameViaBitmap = false;
  private histWaiters: Array<(h: HistPixels | null) => void> = [];
  private suspended = false;
  private scratch: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;

  static create(canvas: HTMLCanvasElement, opts: { preserveDrawingBuffer?: boolean } = {}): FilmRenderer {
    return new FilmRenderer(canvas, opts);
  }

  private constructor(private canvas: HTMLCanvasElement, opts: { preserveDrawingBuffer?: boolean } = {}) {
    this.gl = createContext(canvas, opts);
    this.caps = detectCaps(this.gl, this.warnings);
    this.graph = this.buildGraph();
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
    // 비디오 R 은 캔버스 CSS 크기를 따른다: 크기가 바뀌면(일시정지 중 포함) 다시 그린다
    if (typeof ResizeObserver === "function") {
      this.resizeObs = new ResizeObserver(() => { if (this.asset?.kind === "video") this.scheduleRender(); });
      this.resizeObs.observe(canvas);
    }
  }

  private resizeObs: ResizeObserver | null = null;
  private outSpace: OutputSpace = "srgb";

  /** Step 5 §3: 이 기기·브라우저에서 화면 출력을 Display P3 로 바꿀 수 있는가 */
  supportsP3(): boolean {
    return p3Available(this.gl as unknown as { drawingBufferColorSpace?: string });
  }

  /** 화면(캔버스) 출력 색공간. 기본 sRGB. 미지원이면 sRGB 로 유지한다. 저장(타일 렌더)은 항상 sRGB */
  setOutputSpace(space: OutputSpace): void {
    this.outSpace = space === "display-p3" && this.supportsP3() ? "display-p3" : "srgb";
    this.applyOutputSpace();
    if (this.asset && !this.suspended) this.scheduleRender();
  }

  getOutputSpace(): OutputSpace {
    return this.outSpace;
  }

  private applyOutputSpace(): void {
    const gl = this.gl as unknown as { drawingBufferColorSpace?: string };
    if ("drawingBufferColorSpace" in gl) gl.drawingBufferColorSpace = this.outSpace;
    this.graph.outputSpace = this.outSpace;
  }

  private buildGraph(): RenderGraph {
    const g = new RenderGraph(this.gl, this.caps);
    g.compileAll(PASS_NAMES);
    const t = toneInvTable();
    this.toneInvTex = createTex2D(this.gl, TONE_INV_N, 1, this.gl.R16F, this.gl.RED, this.gl.FLOAT, this.gl.LINEAR, t);
    g.toneInvTex = this.toneInvTex;
    this.curveKey = "";
    return g;
  }

  // ── 컨텍스트 손실 ─────────────────────────────────────────────────────────
  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    this.warn(LOST_WARNING);
  };

  private onRestored = () => {
    this.lost = false;
    // 복구된 컨텍스트는 확장이 모두 꺼진 상태이므로 다시 켠다
    const lostIdx = this.warnings.indexOf(LOST_WARNING);
    if (lostIdx >= 0) this.warnings.splice(lostIdx, 1);
    const videoHalf = this.caps.videoHalfFloatUpload;
    Object.assign(this.caps, detectCaps(this.gl, this.warnings), { videoHalfFloatUpload: videoHalf === null ? null : videoHalf });
    this.graph.pool.forget();
    this.gpuLuts.clear();
    this.sourceLut = null;
    this.sourceLutResolved = "";
    this.curveTex = null;
    this.srcTex = null;
    this.videoFmt = null;
    this.atmPending = null;
    this.graph = this.buildGraph();
    this.applyOutputSpace();
    this.lastChainSig = "";
    if (this.asset?.kind !== "video" && this.asset) this.uploadPhoto(this.asset);
    this.setParams(this.params);
  };

  private warn(w: string): void {
    if (!this.warnings.includes(w)) this.warnings.push(w);
    this.onStatus?.();
  }

  // ── 소스 ─────────────────────────────────────────────────────────────────
  private releaseSource(): void {
    this.videoSrc?.dispose();
    this.videoSrc = null;
    if (this.srcTex) this.gl.deleteTexture(this.srcTex);
    this.srcTex = null;
    this.srcSize = null;
    this.videoFmt = null;
    this.graph.resetTargets();
    this.atm = DEFAULT_ATM;
    this.atmSig = "";
    this.atmVideoSig = "";
    this.atmPending = null;
    this.lastChainSig = "";
    this.lastR = null;
    this.sourceLutResolved = "";
  }

  private uploadPhoto(asset: MediaAsset): void {
    const gl = this.gl;
    const p = asset.proxy;
    this.srcTex = createTex2D(gl, p.width, p.height, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.LINEAR, p.data);
    this.srcSize = { width: p.width, height: p.height };
    this.srcOrient = 1;
  }

  /** 섹션 11: proxy(Float32 RGBA, 표시 방향 적용됨)를 uSrc 로. uOrient = 1, R = 프록시 크기 */
  setPhotoSource(asset: MediaAsset): void {
    this.releaseSource();
    this.asset = asset;
    this.uploadPhoto(asset);
    this.refreshSourceLut();
  }

  /** 섹션 10: 비디오 소스 (회전 메타 + 브라우저 업로드 방향 판별) */
  async setVideoSource(asset: MediaAsset, file: File): Promise<void> {
    this.releaseSource();
    this.asset = asset;
    const info = asset.video;
    if (!info) throw renderErrors.noSource();
    const rot = info.rotation;
    const o = orientationFromMatrix(...rot.matrix);
    if (o.unsupported) this.warn(renderWarnings.rotationUnsupported);
    if (rot.orientation !== 1) {
      this.orientProbe = await probeVideoOrientation(this.graph);
      if (this.orientProbe.status === "unknown") this.warn(renderWarnings.orientationProbeUnknown);
    }
    const vs = new VideoSource(file, info.fps || 30, (t, idx) => this.onVideoFrame(t, idx), () => { this.lastR = null; this.onStatus?.(); });
    this.videoSrc = vs;
    await vs.load();
    if (info.playback4k60 && !info.playback4k60.supported) this.warn("이 기기는 4K60 실시간 디코드를 보장하지 않습니다");
    this.refreshSourceLut();
    this.onVideoFrame(vs.video.currentTime, vs.frameIndexAt(vs.video.currentTime));
  }

  /** 같은 자산의 descriptor 갱신(Log 배지 전환 등). 소스 텍스처는 그대로 둔다 */
  updateAsset(asset: MediaAsset): void {
    if (!this.asset || this.asset.id !== asset.id) return;
    this.asset = asset;
    this.lastChainSig = "";
    this.atmSig = "";
    this.atmVideoSig = "";
    this.refreshSourceLut();
  }

  /** 표시 크기 = 회전 메타 기준 (video.videoWidth 는 신뢰하지 않는다) */
  private displaySize(): Size | null {
    const a = this.asset;
    if (!a) return null;
    if (a.kind === "video" && a.video) return displaySizeOf(a.video.rotation);
    return { width: a.displaySize.width, height: a.displaySize.height };
  }

  /** 섹션 10.3: 비디오 프레임 → srcTex. 처음 한 번 RGBA16F/HALF_FLOAT 업로드 가능 여부를 시험하고 안 되면 RGBA8 로 쓴다 */
  private uploadSource(v: TexImageSource): void {
    const gl = this.gl;
    if (!this.srcTex) this.srcTex = createTex2D(gl, 1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR, null);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    setUnpackState(gl);
    if (!this.videoFmt) {
      while (gl.getError() !== gl.NO_ERROR) { /* 이전 오류 비움 */ }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, v);
      const ok = gl.getError() === gl.NO_ERROR;
      this.caps.videoHalfFloatUpload = ok;
      this.videoFmt = ok ? { internal: gl.RGBA16F, type: gl.HALF_FLOAT } : { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE };
      if (!ok) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, v);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, this.videoFmt.internal, gl.RGBA, this.videoFmt.type, v);
    }
  }

  private uploadVideoFrame(): boolean {
    const v = this.videoSrc?.video;
    const a = this.asset;
    if (!v || !a?.video || v.readyState < 2) return false;
    this.uploadSource(v);
    const rot = a.video.rotation;
    const disp = displaySizeOf(rot);
    const texRot = this.textureRotated(v, rot.orientation);
    this.srcOrient = texRot ? 1 : rot.orientation;
    this.srcSize = texRot ? disp : { width: rot.codedWidth, height: rot.codedHeight };
    return true;
  }

  // ── 내보내기 전용 비디오 (Step 4 §11-3) ──────────────────────────────────
  /** <video> 없이 디코드된 VideoFrame 을 직접 렌더한다. size = 출력 (W2,H2) */
  async setExportVideo(asset: MediaAsset, size: Size): Promise<void> {
    this.releaseSource();
    this.asset = asset;
    this.fixedR = { width: size.width, height: size.height };
    await this.refreshSourceLutAsync();
  }

  /**
   * frame 은 회전이 적용되지 않은 코딩 방향 프레임이다. orient = 잔여 orientation 1..8 전체.
   * texImage2D 가 VideoFrame 을 받지 못해 TypeError 를 던지면 그 뒤로는 createImageBitmap 으로 업로드한다.
   */
  async renderExportFrame(frame: VideoFrame, orient: number, grainSeed: number): Promise<void> {
    if (!this.asset || !this.fixedR) throw renderErrors.noSource();
    if (this.lost) throw renderErrors.lost();
    if (!this.frameViaBitmap) {
      try {
        this.uploadSource(frame);
      } catch (e) {
        if (!(e instanceof TypeError)) throw e;
        this.frameViaBitmap = true;
      }
    }
    if (this.frameViaBitmap) {
      const bitmap = await createImageBitmap(frame);
      try { this.uploadSource(bitmap); } finally { bitmap.close(); }
    }
    this.srcOrient = orient;
    this.srcSize = { width: frame.displayWidth || frame.codedWidth, height: frame.displayHeight || frame.codedHeight };
    this.frameIndex = grainSeed;
    this.renderNow();
  }

  /**
   * 섹션 10.2-6 textureRotated. 프로브 영상 자체를 디코드하지 못해 dimsRotated 도 없을 때(코덱 미지원 등)는
   * 같은 크기 비교(폴백)를 실제 영상에 적용한다: videoWidth×videoHeight 가 coded 의 가로세로 교환이면 회전된 업로드.
   */
  private textureRotated(v: HTMLVideoElement, orientation: number): boolean {
    const p = this.orientProbe;
    if (orientation === 1 || !p) return false;
    if (p.status !== "unknown" || p.dimsRotated !== null) return p.textureRotated;
    const rot = this.asset?.video?.rotation;
    if (!rot || orientation < 5 || rot.codedWidth === rot.codedHeight) return false;
    return v.videoWidth === rot.codedHeight && v.videoHeight === rot.codedWidth;
  }

  private onVideoFrame(mediaTime: number, frameIndex: number): void {
    if (this.disposed || this.lost) return;
    this.frameIndex = frameIndex;
    if (!this.uploadVideoFrame()) return;
    this.pollAtm();
    try {
      this.renderNow();
    } catch (e) {
      this.onError?.(e as Error);
    }
    void mediaTime;
  }

  // ── 파라미터·리소스 ───────────────────────────────────────────────────────
  setParams(p: RenderParams): void {
    this.params = p;
    const seq = ++this.resourceSeq;
    this.ready = this.syncResources(seq).catch((e: unknown) => { this.onError?.(e as Error); });
    void this.ready.then(() => { if (seq === this.resourceSeq) this.scheduleRender(); });
  }

  /** 현재 파라미터의 LUT 등 비동기 리소스가 준비될 때까지 기다린다 */
  whenReady(): Promise<void> {
    return this.ready;
  }

  private simMeta(): ManifestSim | null {
    if (this.params.sim === "none") return null;
    return this.manifest?.sims.find((s) => s.id === this.params.sim) ?? null;
  }

  private async syncResources(seq: number): Promise<void> {
    if (!this.manifest) {
      try { this.manifest = await loadManifest(); } catch (e) { throw renderErrors.lut(e instanceof Error ? e.message : String(e)); }
    }
    const p = this.params;
    let key: string | null = null;
    if (p.lookLutId) {
      const l = await loadStoreLut(p.lookLutId);
      if (!l) throw renderErrors.lut(`외부 LUT ${p.lookLutId} 없음`);
      if (seq !== this.resourceSeq) return;
      key = this.ensureGpuLut(l, l).cpu.key;
    } else if (p.sim !== "none") {
      const sim = this.manifest.sims.find((s) => s.id === p.sim);
      if (!sim) throw renderErrors.lut(`알 수 없는 시뮬레이션 ${p.sim}`);
      let l: CpuLut;
      try { l = await loadBuiltinLut(sim, this.manifest.size); } catch (e) { throw renderErrors.lut(e instanceof Error ? e.message : String(e)); }
      if (seq !== this.resourceSeq) return;
      key = this.ensureGpuLut(l, null).cpu.key;
      this.evictBuiltins();
    }
    this.lutKey = key;
    await this.refreshSourceLutAsync();
  }

  private ensureGpuLut(l: CpuLut, store: StoreLut | null): GpuLut {
    let g = this.gpuLuts.get(l.key);
    if (!g) {
      g = { cpu: l, tex: createLut3D(this.gl, l.size, l.data) };
      if (store) {
        const m = store.meta;
        g.flags = { inVR: m.inVideoRange, outVR: m.outVideoRange, min: m.domainMin, max: m.domainMax, domain: DOMAIN_INDEX[m.inputDomain], name: m.name };
      }
      this.gpuLuts.set(l.key, g);
    } else {
      this.gpuLuts.delete(l.key);
      this.gpuLuts.set(l.key, g);
    }
    return g;
  }

  /** 내장 LUT GPU 텍스처도 최근 4개만 유지 */
  private evictBuiltins(): void {
    const builtins = [...this.gpuLuts.keys()].filter((k) => k.startsWith("builtin:"));
    while (builtins.length > 4) {
      const k = builtins.shift()!;
      if (k === this.lutKey) continue;
      const g = this.gpuLuts.get(k);
      if (g) this.gl.deleteTexture(g.tex);
      this.gpuLuts.delete(k);
    }
  }

  /** 공식 소스 변환 LUT 등록·해제 직후 캐시를 버리고 다시 읽는다 (Step 4 §4-5) */
  refreshSourceLut(): void {
    this.sourceLutResolved = "";
    this.sourceLut = null;
    this.sourceLutMissing = false;
    this.lastChainSig = "";
    void this.refreshSourceLutAsync().then(() => { this.onStatus?.(); this.scheduleRender(); });
  }

  private sourceLutResolved = "";

  private async refreshSourceLutAsync(): Promise<void> {
    const a = this.asset;
    const want = a ? storeSourceProfile(a.descriptor.profile) : null;
    if (!want) { this.sourceLut = null; this.sourceLutMissing = false; this.sourceLutResolved = ""; return; }
    // 같은 (자산, 프로파일, 선택 LUT) 이면 IndexedDB 를 다시 읽지 않는다
    const rkey = JSON.stringify([a!.id, want, this.params.sourceLutId]);
    if (rkey === this.sourceLutResolved && (this.sourceLut || this.sourceLutMissing)) return;
    this.sourceLutResolved = rkey;
    let id = this.params.sourceLutId;
    if (!id) id = (await listStoreLuts()).find((m) => m.role === "source-transform" && m.sourceProfile === want)?.id ?? null;
    const l = id ? await loadStoreLut(id) : null;
    if (!l || l.meta.role !== "source-transform") {
      // Step 4: LUT 가 없으면 내장 변환 (Samsung Log 공식 수식 / D-Log M 근사)
      this.sourceLut = null;
      this.sourceLutMissing = true;
      return;
    }
    this.sourceLutMissing = false;
    this.sourceLut = this.ensureGpuLut(l, l);
  }

  // ── 체인 파라미터 ─────────────────────────────────────────────────────────
  /** Step 4 §4-3: 사용자 공식 LUT 가 로드되어 있으면 profile 13, 없으면 내장 변환 (절대 Rec.709 폴백 없음) */
  private binding(d: SourceDescriptor): InputBinding {
    return resolveInputBinding(d, this.sourceLut !== null);
  }

  private profileIndex(d: SourceDescriptor): number {
    return this.binding(d).profile;
  }

  private normalizeUniforms(d: SourceDescriptor): { u: NormalizeUniforms; ctx: NormalizeCtx } {
    const b = this.binding(d);
    const profile = b.profile;
    const srcToWS: Mat3 = b.srcToWS;
    const e = this.effective();
    const wb = wbMatrix(e.adjust.temp, e.adjust.tint);
    const sl = b.useSourceLut ? this.sourceLut : null;
    const ctx: NormalizeCtx = {
      profile,
      limitedCV: b.limitedCV,
      srcToWS,
      rawScale: d.rawScale ?? 1,
      srcLut: sl ? { size: sl.cpu.size, data: sl.cpu.data, inVR: sl.flags?.inVR ?? false, outVR: sl.flags?.outVR ?? false } : null,
      samsungFix: b.samsungFix,
      rgc: d.primaries !== "srgb",
      rolloff: b.rolloff,
      wb,
      expGain: scalarUniforms(e).uExpGain,
      rollW: this.ispFor(1).uRollW,
    };
    const u: NormalizeUniforms = {
      profile, limitedCV: ctx.limitedCV, srcToWS: colMajor(srcToWS), rawScale: ctx.rawScale,
      srcLut: sl ? { tex: sl.tex, N: sl.cpu.size, inVR: ctx.srcLut!.inVR, outVR: ctx.srcLut!.outVR } : null,
      samsungFix: ctx.samsungFix, rgc: ctx.rgc, rolloff: ctx.rolloff, wb: colMajor(wb),
    };
    return { u, ctx };
  }

  /** 현재 자산의 입력 바인딩 (배지 문구·approximate 표시용) */
  inputBinding(): InputBinding | null {
    return this.asset ? this.binding(this.asset.descriptor) : null;
  }

  private probeOverride: ProbeOverride | null = null;

  private effective(): Effective {
    const e = effectiveParams(this.params, this.simMeta()?.mono ?? false);
    const o = this.probeOverride;
    if (!o) return e;
    return {
      ...e, hdf: false,
      adjust: { ...e.adjust, dehaze: 0, shadows: 0, highlights: 0, whites: 0, blacks: 0, brightness: 0, lightBalance: 0, clarity: 0, sharpen: 0, grainAmount: o.grainAmount },
    };
  }

  /**
   * FSE-v2 §5-6 카메라 ISP 유니폼. brand = 현재 필름의 브랜드(필름 없음 null), profile = 입력 바인딩 uProfile,
   * renderScale = 이 렌더의 이미지 폭 / 풀해상도 표시 폭. 프로브는 공간 단계(MH, ZS·팝, ES)를 끈다.
   */
  private ispFor(renderScale: number): IspUniforms {
    const a = this.asset;
    const u = ispUniforms({
      brand: this.simMeta()?.brand ?? null,
      filmStrength: this.params.filmStrength,
      dRange: this.params.dRange,
      profile: a ? this.profileIndex(a.descriptor) : 0,
      renderScale,
    });
    return this.probeOverride ? { ...u, uIspMh: 0, uIspSd: 0, uIspPop: 0, uIspEs: 0 } : u;
  }

  /** 미리보기·동영상 저장의 렌더 배율: 렌더 폭 / 표시 폭 */
  private previewScale(R: Size): number {
    const d = this.displaySize();
    return d && d.width > 0 ? R.width / d.width : 1;
  }

  private curve(): { on: boolean; tex: WebGLTexture } {
    const c = this.params.curve;
    const key = JSON.stringify(c);
    if (key !== this.curveKey || !this.curveTex) {
      this.curveTable = bakeCurve(c);
      if (this.curveTex) this.gl.deleteTexture(this.curveTex);
      this.curveTex = createTex2D(this.gl, CURVE_N, 1, this.gl.R16F, this.gl.RED, this.gl.FLOAT, this.gl.LINEAR, this.curveTable);
      this.curveKey = key;
    }
    return { on: curveOn(c), tex: this.curveTex };
  }

  private lutUniforms(): LutUniforms {
    const g = this.lutKey ? this.gpuLuts.get(this.lutKey) : undefined;
    if (!g) return { mode: 0, tex: null, N: 2, domain: 0, inVR: false, outVR: false, min: [0, 0, 0], max: [1, 1, 1] };
    if (g.flags) return { mode: 2, tex: g.tex, N: g.cpu.size, domain: g.flags.domain, inVR: g.flags.inVR, outVR: g.flags.outVR, min: g.flags.min, max: g.flags.max };
    return { mode: 1, tex: g.tex, N: g.cpu.size, domain: 0, inVR: false, outVR: false, min: [0, 0, 0], max: [1, 1, 1] };
  }

  /** 렌더 크기 R: 사진 = 프록시, 비디오 = 섹션 10.5 */
  private renderSize(): Size {
    if (this.fixedR) return this.fixedR;
    const a = this.asset!;
    if (a.kind !== "video") return { width: a.proxy.width, height: a.proxy.height };
    const disp = this.displaySize()!;
    const cssLong = Math.max(this.canvas.clientWidth, this.canvas.clientHeight) || Math.max(disp.width, disp.height);
    const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
    const tier = this.videoSrc?.tier ?? 1;
    const rLong = Math.max(1, Math.round(Math.min(1920, cssLong * dpr) * tier));
    return scaledSize(disp, rLong);
  }

  /** 출력 이미지 짧은 변 (그레인 크기 기준: 1080 프레임 정규화) */
  private outShort(): number {
    const d = this.displaySize()!;
    return Math.min(d.width, d.height);
  }

  private chainParams(R: Size, renderScale: number = this.previewScale(R)): ChainParams {
    const a = this.asset!;
    const e = this.effective();
    const s = scalarUniforms(e);
    const isp = this.ispFor(renderScale);
    const seed = a.kind === "video" ? this.frameIndex : 0;
    return {
      mode: a.kind === "video" ? "video" : "photo",
      R,
      src: { tex: this.srcTex!, size: this.srcSize!, orient: this.srcOrient },
      norm: this.normalizeUniforms(a.descriptor).u,
      s,
      toneOps: toneOpsOn(e) || isp.uIspSd > 0 || isp.uIspPop > 0,
      hdf: e.hdf,
      mono: e.mono,
      curve: this.curve(),
      lut: this.lutUniforms(),
      wsToSG3C: colMajor(inv3(matrixToWS("s-gamut3-cine") as Mat3)),
      grain: { scale: grainScalePreview(this.outShort(), Math.min(R.width, R.height)), off: grainOffset(seed), coarse: grainCoarse(e.adjust.grainSize) },
      hdfPlan: hdfPlan(R),
      isp,
      mhPlan: mhPlan(R),
    };
  }

  /** 체인 서명: 미리보기 결과(tHalo, tTrans, tToneAB, tClarAB, A)가 현재 파라미터와 같은지 */
  private chainSig(R: Size): string {
    const a = this.asset;
    return JSON.stringify([a?.id, a?.descriptor, R, this.params, this.lutKey, this.sourceLut?.cpu.key ?? null]);
  }

  private atmSignature(R: Size): string {
    const a = this.asset;
    const e = this.effective();
    return JSON.stringify([a?.id, a?.descriptor, this.sourceLut?.cpu.key ?? null, e.adjust.temp, e.adjust.tint, e.adjust.exposure, e.hdf, R]);
  }

  /** Step 4 §10-4(2): 저장 중에는 프리뷰 렌더를 멈춘다 (renderTile 은 그대로 동작) */
  setSuspended(on: boolean): void {
    this.suspended = on;
    if (!on) this.scheduleRender();
  }

  /** 프리뷰를 한 번 렌더하고 같은 태스크 안에서 RGBA8 로 복사한다 (예상 용량 계산용 프록시 렌더, §10-6) */
  snapshotPreview(): { width: number; height: number; data: Uint8ClampedArray } {
    this.renderNow();
    const w = this.canvas.width, h = this.canvas.height;
    if (!this.scratch) {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw renderErrors.lost();
      this.scratch = { canvas, ctx };
    }
    this.scratch.canvas.width = w;
    this.scratch.canvas.height = h;
    this.scratch.ctx.drawImage(this.canvas, 0, 0);
    const img = this.scratch.ctx.getImageData(0, 0, w, h);
    return { width: w, height: h, data: img.data };
  }

  private scheduleRender(): void {
    if (this.rafPending || this.disposed || this.suspended) return;
    if (this.asset?.kind === "video" && this.videoSrc && !this.videoSrc.video.paused) return; // 재생 중엔 표시 프레임이 렌더를 이끈다
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      if (!this.asset || this.lost) return;
      try {
        if (this.asset.kind === "video") this.uploadVideoFrame();
        this.renderNow();
      } catch (e) {
        this.onError?.(e as Error);
      }
    });
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  renderNow(): RenderStats {
    const waiters = this.histWaiters;
    this.histWaiters = [];
    try {
      const r = this.renderNowInner(waiters.length > 0);
      for (const w of waiters) w(r.hist);
      return r.stats;
    } catch (e) {
      for (const w of waiters) w(null);
      throw e;
    }
  }

  /** Step 4 §8-4: 다음 렌더에 히스토그램용 픽셀(긴 변 256 RGBA8)을 함께 읽어 돌려준다. 렌더를 예약한다 */
  requestHistogram(): Promise<HistPixels | null> {
    return new Promise((res) => {
      this.histWaiters.push(res);
      this.scheduleRender();
    });
  }

  /** Step 4 §9-1: S0(uExpGain=1) 긴 변 256 의 휘도 배열. 비디오는 현재 표시 프레임 */
  readAnalysisLuma(): Float32Array {
    if (!this.asset || !this.srcTex || !this.srcSize) throw renderErrors.noSource();
    if (this.asset.kind === "video") this.uploadVideoFrame();
    const R = this.renderSize();
    const c = this.chainParams(R);
    return this.graph.analysisLuma(c, c.src.tex, c.src.size, c.src.orient);
  }

  /** 컬러 자동 보정·WB 스포이트: WB 적용 전(항등)·노출 이득 1 의 WS 선형 RGBA, 표시 방향, 긴 변 `long`px. 비디오는 현재 표시 프레임 */
  readAnalysisRgb(long = 256): { width: number; height: number; data: Float32Array } {
    if (!this.asset || !this.srcTex || !this.srcSize) throw renderErrors.noSource();
    if (this.asset.kind === "video") this.uploadVideoFrame();
    const R = this.renderSize();
    const c = this.chainParams(R);
    return this.graph.analysisRgb(c, c.src.tex, c.src.size, c.src.orient, long, colMajor(IDENTITY3));
  }

  /**
   * WB 스포이트 표본: (u,v) ∈ [0,1]² (표시 방향) 주변 (2r+1)² 창의 WB 적용 전·노출 이득 1 WS 선형 RGB 평균.
   * 사진은 메모리에 있는 CPU 프록시(표시 방향 Float32)를 reference.ts 의 normalizePixel 로 정규화해 GL 상태를 건드리지 않는다.
   * 비디오(프레임이 GPU 텍스처에만 있음)만 readAnalysisRgb 로 폴백한다. 범위 밖 좌표·표본 없음 → null
   */
  sampleWsPatch(u: number, v: number, r = 2): [number, number, number] | null {
    const a = this.asset;
    if (!a || !Number.isFinite(u) || !Number.isFinite(v) || u < 0 || u > 1 || v < 0 || v > 1) return null;
    let n = 0, sr = 0, sg = 0, sb = 0;
    const add = (R: number, G: number, B: number) => {
      if (Number.isFinite(R) && Number.isFinite(G) && Number.isFinite(B)) { sr += R; sg += G; sb += B; n++; }
    };
    if (a.kind === "video") {
      const g = this.readAnalysisRgb(1024);
      const x = Math.min(g.width - 1, Math.floor(u * g.width)), y = Math.min(g.height - 1, Math.floor(v * g.height));
      for (let j = Math.max(0, y - r); j <= Math.min(g.height - 1, y + r); j++) {
        for (let i = Math.max(0, x - r); i <= Math.min(g.width - 1, x + r); i++) {
          const o = (j * g.width + i) * 4;
          add(g.data[o]!, g.data[o + 1]!, g.data[o + 2]!);
        }
      }
    } else {
      const p = a.proxy;
      const ctx: NormalizeCtx = { ...this.normalizeUniforms(a.descriptor).ctx, wb: IDENTITY3, expGain: 1 };
      const x = Math.min(p.width - 1, Math.floor(u * p.width)), y = Math.min(p.height - 1, Math.floor(v * p.height));
      for (let j = Math.max(0, y - r); j <= Math.min(p.height - 1, y + r); j++) {
        for (let i = Math.max(0, x - r); i <= Math.min(p.width - 1, x + r); i++) {
          const o = (j * p.width + i) * 4;
          const w = normalizePixel([p.data[o]!, p.data[o + 1]!, p.data[o + 2]!], ctx);
          add(w[0], w[1], w[2]);
        }
      }
    }
    return n === 0 ? null : [sr / n, sg / n, sb / n];
  }

  private renderNowInner(wantHist: boolean): { stats: RenderStats; hist: HistPixels | null } {
    const t0 = performance.now();
    if (!this.asset || !this.srcTex || !this.srcSize) throw renderErrors.noSource();
    if (this.lost) throw renderErrors.lost();
    const R = this.renderSize();
    if (!this.lastR || this.lastR.width !== R.width || this.lastR.height !== R.height) {
      this.graph.resetTargets();
      this.lastR = R;
      this.atmSig = "";
    }
    if (this.canvas.width !== R.width) this.canvas.width = R.width;
    if (this.canvas.height !== R.height) this.canvas.height = R.height;
    const c = this.chainParams(R);
    const atmReq = this.atmRequest(R, c.s.uDehaze);
    const r = this.graph.renderPreview(c, { kind: "canvas", hist: wantHist }, atmReq, (A) => { this.atm = A; });
    this.atm = r.atm;
    if (r.dzA) this.startAtmRead(r.dzA);
    this.lastChainSig = this.chainSig(R);
    this.chainVersion++;
    const stats = { passes: r.passes, cpuMs: performance.now() - t0, R };
    this.onStatus?.();
    return { stats, hist: r.hist };
  }

  private atmRequest(R: Size, dehaze: number): { value: Vec3; refresh: "none" | "sync" | "async" } {
    if (dehaze === 0) return { value: this.atm, refresh: "none" };
    const sig = this.atmSignature(R);
    if (this.asset?.kind === "video") {
      this.atmFrames++;
      const need = !this.atmPending && (this.atmVideoSig !== sig || this.atmFrames >= 120);
      if (need) { this.atmVideoSig = sig; this.atmFrames = 0; return { value: this.atm, refresh: "async" }; }
      return { value: this.atm, refresh: "none" };
    }
    if (sig !== this.atmSig) { this.atmSig = sig; return { value: this.atm, refresh: "sync" }; }
    return { value: this.atm, refresh: "none" };
  }

  /** 섹션 10.6 PIXEL_PACK_BUFFER + fenceSync 비동기 판독 */
  private startAtmRead(t: import("./gl").Target): void {
    const gl = this.gl;
    const buf = gl.createBuffer();
    if (!buf) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    const half = (gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE) as number) === gl.HALF_FLOAT;
    const bytes = t.width * t.height * 4 * (half ? 2 : 4);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
    gl.readPixels(0, 0, t.width, t.height, gl.RGBA, half ? gl.HALF_FLOAT : gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    this.graph.pool.release(t);
    if (!sync) { gl.deleteBuffer(buf); return; }
    gl.flush();
    this.atmPending = { buf, sync, w: t.width, h: t.height, half };
  }

  private pollAtm(): void {
    const p = this.atmPending;
    if (!p) return;
    const gl = this.gl;
    if (gl.getSyncParameter(p.sync, gl.SYNC_STATUS) !== gl.SIGNALED) return;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, p.buf);
    let px: Float32Array;
    if (p.half) {
      const u = new Uint16Array(p.w * p.h * 4);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, u);
      px = Float32Array.from(u, halfToFloat);
    } else {
      px = new Float32Array(p.w * p.h * 4);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, px);
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.deleteBuffer(p.buf);
    gl.deleteSync(p.sync);
    this.atmPending = null;
    void import("./dehaze-atm").then(({ computeAtmosphere }) => { this.atm = computeAtmosphere(px, p.w, p.h); });
  }

  /** GPU↔CPU 프로브: RGBA16F, 디더 끔. points 는 (u,v) ∈ [0,1]², 결과는 점마다 RGBA 4개 */
  probe(points: Array<[number, number]>, override: ProbeOverride = { grainAmount: 0 }): Float32Array {
    if (!this.asset || !this.srcTex || !this.srcSize) throw renderErrors.noSource();
    this.probeOverride = override;
    try {
      const R = this.renderSize();
      const c = this.chainParams(R);
      const r = this.graph.renderPreview(c, { kind: "probe" }, { value: this.atm, refresh: "none" }, () => undefined);
      const t = r.probeTarget!;
      const out = new Float32Array(points.length * 4);
      const gl = this.gl;
      points.forEach(([u, v], k) => {
        const x = Math.min(R.width - 1, Math.floor(u * R.width));
        const y = Math.min(R.height - 1, Math.floor(v * R.height));
        const px = new Float32Array(4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
        const type = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE) as number;
        if (type === gl.HALF_FLOAT) {
          const h = new Uint16Array(4);
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.HALF_FLOAT, h);
          for (let i = 0; i < 4; i++) px[i] = halfToFloat(h[i]!);
        } else gl.readPixels(x, y, 1, 1, gl.RGBA, gl.FLOAT, px);
        out.set(px, k * 4);
      });
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.graph.pool.release(t);
      return out;
    } finally {
      this.probeOverride = null;
      this.lastChainSig = "";
    }
  }

  /**
   * WB 스포이트용: Pre-WB(WS 선형) 표본 + 표본 위치 (u,v) → (temp, tint) 에서의 최종 표시 RGB.
   * 현재 필름 LUT·ISP 숄더·강도 혼합·톤 커브·채도·비네팅 등 픽셀 단계 전체(CPU 참조)를 통과시키고, 그레인은 끈다.
   */
  wbOutputEval(sample: [number, number, number], u: number, v: number): (temp: number, tint: number) => number[] {
    const { ctx, R } = this.referenceContext({ grainAmount: 0 });
    const expGain = ctx.norm.expGain;
    const pxX = Math.min(R.width - 1, Math.floor(u * R.width)) + 0.5, pxY = Math.min(R.height - 1, Math.floor(v * R.height)) + 0.5;
    return (temp, tint) => {
      const m = wbMatrix(temp, tint);
      const x = apply3(m, sample).map((q) => q * expGain);
      return Array.from(pixelPipelineFromWs(x, u, v, pxX, pxY, { ...ctx, grain: null }));
    };
  }

  /** 프로브와 같은 조건의 CPU 참조 컨텍스트 (섹션 15.1) */
  referenceContext(override: ProbeOverride = { grainAmount: 0 }): { ctx: PixelCtx; R: Size } {
    if (!this.asset) throw renderErrors.noSource();
    this.probeOverride = override;
    try {
      const R = this.renderSize();
      const e = this.effective();
      const s = scalarUniforms(e);
      const g = this.lutKey ? this.gpuLuts.get(this.lutKey) : undefined;
      let lut: LutStageRef = { mode: 0 };
      if (g?.flags) {
        const names = ["srgb-display", "rec709-bt1886", "fsh-v1", "slog3-sgamut3cine"] as const;
        lut = { mode: 2, size: g.cpu.size, data: g.cpu.data, domain: names[g.flags.domain]!, inVR: g.flags.inVR, outVR: g.flags.outVR, domMin: g.flags.min, domMax: g.flags.max };
      } else if (g) lut = { mode: 1, size: g.cpu.size, data: g.cpu.data };
      this.curve();
      const ctx: PixelCtx = {
        norm: this.normalizeUniforms(this.asset.descriptor).ctx,
        ct: s.uCt, vig: s.uVig, aspect: R.width / R.height, lut, mono: e.mono, ke: s.uKe, kb: s.uKb,
        curve: curveOn(this.params.curve) ? this.curveTable : null,
        sat: s.uSat, vib: s.uVib, filmStrength: s.uFilmStrength, monoTint: s.uMonoTint,
        isp: (() => { const q = this.ispFor(1); return { drStops: q.uDrStops, sceneRef: q.uSceneRef, hd: q.uIspHd, drY0: q.uDrY0, drS: q.uDrS }; })(),
        grain: s.uGrainAmt > 0 ? { amount: s.uGrainAmt, scale: grainScalePreview(this.outShort(), Math.min(R.width, R.height)), off: grainOffset(0), coarse: grainCoarse(e.adjust.grainSize) } : null,
      };
      return { ctx, R };
    } finally {
      this.probeOverride = null;
    }
  }

  // ── 원본 해상도 타일 (섹션 12) ───────────────────────────────────────────
  async renderTile(req: { rect: { x: number; y: number; width: number; height: number }; outScale: number }): Promise<Uint8ClampedArray> {
    const a = this.asset;
    if (!a || a.kind === "video") throw renderErrors.noSource();
    if (!this.lastR || this.lastChainSig !== this.chainSig(this.lastR)) throw renderErrors.stale();
    const sig = this.lastChainSig;
    const { rect, outScale } = req;
    const disp = this.displaySize()!;
    const outFull = { width: Math.round(disp.width * outScale), height: Math.round(disp.height * outScale) };
    if (rect.width > 1024 || rect.height > 1024 || rect.x < 0 || rect.y < 0 || rect.x + rect.width > outFull.width || rect.y + rect.height > outFull.height) throw renderErrors.tileTooLarge();
    const P = tilePadding(outFull);
    // 실제 패딩: P 이상으로 넓혀 패딩 포함 원점·크기를 2^n_core 배수에 맞춘다. 타일마다 HDF core 피라미드
    // (ceil(R/2ⁿ), 로컬 uv 샘플)가 전체 이미지와 같은 격자를 쓰게 해 이음새를 없앤다 (docs/RENDERER.md 구현 노트).
    const al = 2 ** hdfPlan(outFull).core.level;
    const px0 = Math.max(0, Math.floor((rect.x - P) / al) * al), py0 = Math.max(0, Math.floor((rect.y - P) / al) * al);
    const px1 = Math.min(outFull.width, px0 + Math.ceil((rect.x + rect.width + P - px0) / al) * al);
    const py1 = Math.min(outFull.height, py0 + Math.ceil((rect.y + rect.height + P - py0) / al) * al);
    const sx0 = Math.max(0, Math.floor(px0 / outScale)), sy0 = Math.max(0, Math.floor(py0 / outScale));
    const sx1 = Math.min(disp.width, Math.ceil(px1 / outScale)), sy1 = Math.min(disp.height, Math.ceil(py1 / outScale));
    if (sx1 - sx0 > 2048 || sy1 - sy0 > 2048) throw renderErrors.tileTooLarge();
    const tile = await getFullResolutionTile(a.id, { x: sx0, y: sy0, width: sx1 - sx0, height: sy1 - sy0 });
    if (this.asset !== a || this.lastChainSig !== sig) throw renderErrors.stale();
    const gl = this.gl;
    const tex = createTex2D(gl, tile.width, tile.height, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.LINEAR, tile.data);
    try {
      const Rt = { width: px1 - px0, height: py1 - py0 };
      // 렌더 배율 = outScale (사진 저장 1, 확대 디테일 오버레이 s)
      const base = this.chainParams(this.lastR, outScale);
      const e = this.effective();
      base.R = Rt;
      base.grain = { scale: grainScaleFull(Math.min(outFull.width, outFull.height)), off: grainOffset(0), coarse: grainCoarse(e.adjust.grainSize) };
      const out = this.graph.renderTile({
        base, R: Rt, imageSize: outFull, tileOrigin: [px0, py0], crop: [rect.x - px0, rect.y - py0], imgPxOrigin: [rect.x, rect.y],
        out: { width: rect.width, height: rect.height }, hdfPlan: hdfPlan(outFull), mhPlan: mhPlan(outFull), atm: this.atm,
      }, tex, { width: tile.width, height: tile.height });
      return new Uint8ClampedArray(out.buffer);
    } finally {
      gl.deleteTexture(tex);
    }
  }

  // ── 비디오 제어 ───────────────────────────────────────────────────────────
  readonly video = {
    play: async (): Promise<void> => { await this.videoSrc?.play(); },
    pause: (): void => { this.videoSrc?.pause(); },
    seek: (t: number): void => { this.videoSrc?.seek(t); },
    stats: (): VideoStats => this.videoSrc?.stats() ?? { presentedFps: 0, dropped: 0, tier: 1 },
    element: (): HTMLVideoElement | null => this.videoSrc?.video ?? null,
  };

  info(): RendererInfo {
    const R = this.lastR;
    const sz = R && this.asset ? graphSizes(R, this.asset.kind === "video" ? "video" : "photo") : null;
    let pi: number | null = null;
    try { pi = this.asset ? this.profileIndex(this.asset.descriptor) : null; } catch { pi = null; }
    return {
      R, A: sz?.A ?? null, D: sz?.D ?? null, profileIndex: pi, orient: this.srcOrient, srcSize: this.srcSize, atm: this.atm,
      lutKey: this.lutKey, sourceLutName: this.sourceLut?.flags?.name ?? (this.sourceLutMissing ? "(내장 변환)" : null),
      orientationProbe: this.orientProbe, chainVersion: this.chainVersion,
    };
  }

  /** 섹션 10.2 결과를 미리 확인한다 (검증 화면용) */
  runOrientationProbe(): Promise<OrientationProbeResult> {
    return probeVideoOrientation(this.graph);
  }

  dispose(): void {
    this.disposed = true;
    this.resizeObs?.disconnect();
    this.releaseSource();
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    for (const g of this.gpuLuts.values()) this.gl.deleteTexture(g.tex);
    this.gpuLuts.clear();
    if (this.curveTex) this.gl.deleteTexture(this.curveTex);
    if (this.toneInvTex) this.gl.deleteTexture(this.toneInvTex);
    this.graph.dispose();
    this.asset = null;
  }
}

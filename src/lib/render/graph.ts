// 섹션 7 렌더 그래프 — 패스 순서와 생략 규칙(실효 파라미터 기준), 미리보기·타일 공통.
import { computeAtmosphere, type Vec3 } from "./dehaze-atm";
import { buildProgram, createLut3D, createTex2D, readFloatRGBA, renderErrors, TargetPool, type Program, type RendererCaps, type Sized, type Target } from "./gl";
import type { PassName } from "./glsl";
import type { ScalarUniforms } from "./params";
import { graphSizes, levelSize, type HdfPlan, type MediaMode, type Size } from "./plan";

type TexLike = WebGLTexture | Target;

export interface DrawSpec {
  pass: PassName;
  target: Target | null;
  size: Sized;
  f?: Record<string, number>;
  /** int·bool 유니폼 */
  i?: Record<string, number | boolean>;
  v2?: Record<string, readonly [number, number]>;
  v3?: Record<string, readonly number[]>;
  iv2?: Record<string, readonly [number, number]>;
  m3?: Record<string, Float32Array>;
  tex?: Record<string, TexLike | null>;
}

export interface NormalizeUniforms {
  profile: number;
  limitedCV: boolean;
  srcToWS: Float32Array;
  rawScale: number;
  srcLut: { tex: WebGLTexture; N: number; inVR: boolean; outVR: boolean } | null;
  samsungFix: boolean;
  rgc: boolean;
  rolloff: boolean;
  wb: Float32Array;
}

export interface LutUniforms {
  mode: 0 | 1 | 2;
  tex: WebGLTexture | null;
  N: number;
  domain: number;
  inVR: boolean;
  outVR: boolean;
  min: Vec3;
  max: Vec3;
}

export interface ChainParams {
  mode: MediaMode;
  /** 렌더 크기 R */
  R: Size;
  src: { tex: WebGLTexture; size: Size; orient: number };
  norm: NormalizeUniforms;
  s: ScalarUniforms;
  toneOps: boolean;
  hdf: boolean;
  mono: boolean;
  curve: { on: boolean; tex: WebGLTexture };
  lut: LutUniforms;
  wsToSG3C: Float32Array;
  grain: { scale: number; off: [number, number] };
  /** σ 는 R 픽셀 단위 (미리보기: D = diag(R)) */
  hdfPlan: HdfPlan;
}

export type PreviewOutput = { kind: "canvas" } | { kind: "probe" };
export interface AtmRequest { value: Vec3; refresh: "none" | "sync" | "async" }
export interface PreviewResult { passes: number; atm: Vec3; probeTarget: Target | null; dzA: Target | null }

export interface TileChain {
  base: ChainParams;
  /** 패딩 포함 렌더 크기 (출력 px) */
  R: Size;
  /** 출력 전체 이미지 크기 */
  imageSize: Size;
  /** 패딩 포함 원점 (출력 px) */
  tileOrigin: [number, number];
  /** 실제 패딩 (uCropOrigin) */
  crop: [number, number];
  /** rect 원점 (uImgPxOrigin) */
  imgPxOrigin: [number, number];
  /** rect 크기 */
  out: Size;
  /** 출력 전체 기준 HDF (core 만 타일 안에서 계산) */
  hdfPlan: HdfPlan;
  atm: Vec3;
}

export class RenderGraph {
  private programs = new Map<PassName, Program>();
  readonly pool: TargetPool;
  private dummy2D: WebGLTexture;
  private dummy3D: WebGLTexture;
  private vao: WebGLVertexArrayObject;
  /** 타일 렌더가 재사용하는 미리보기 결과 */
  persist: { tHalo: Target | null; tTrans: Target | null; tToneAB: Target | null; tClarAB: Target | null } = { tHalo: null, tTrans: null, tToneAB: null, tClarAB: null };
  passes = 0;

  constructor(readonly gl: WebGL2RenderingContext, readonly caps: RendererCaps) {
    this.pool = new TargetPool(gl, caps);
    this.dummy2D = createTex2D(gl, 1, 1, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.NEAREST, new Float32Array(4));
    this.dummy3D = createLut3D(gl, 1, new Float32Array(3));
    const vao = gl.createVertexArray();
    if (!vao) throw renderErrors.lost();
    this.vao = vao;
  }

  /** 모든 프로그램을 미리 컴파일한다 (컴파일 오류를 초기화 시점에 드러낸다) */
  compileAll(names: ReadonlyArray<PassName>): void {
    for (const n of names) this.program(n);
  }

  program(pass: PassName): Program {
    let p = this.programs.get(pass);
    if (!p) { p = buildProgram(this.gl, pass); this.programs.set(pass, p); }
    return p;
  }

  dispose(): void {
    const gl = this.gl;
    this.pool.clear();
    for (const p of this.programs.values()) gl.deleteProgram(p.prog);
    this.programs.clear();
    gl.deleteTexture(this.dummy2D);
    gl.deleteTexture(this.dummy3D);
    gl.deleteVertexArray(this.vao);
    this.persist = { tHalo: null, tTrans: null, tToneAB: null, tClarAB: null };
  }

  /** 소스나 R 이 바뀌면 풀을 비운다 */
  resetTargets(): void {
    this.pool.clear();
    this.persist = { tHalo: null, tTrans: null, tToneAB: null, tClarAB: null };
  }

  draw(d: DrawSpec): void {
    const gl = this.gl;
    const p = this.program(d.pass);
    gl.bindFramebuffer(gl.FRAMEBUFFER, d.target ? d.target.fbo : null);
    gl.viewport(0, 0, d.size.width, d.size.height);
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.vao);
    for (const [k, v] of Object.entries(d.f ?? {})) gl.uniform1f(p.loc(k), v);
    for (const [k, v] of Object.entries(d.i ?? {})) gl.uniform1i(p.loc(k), typeof v === "boolean" ? (v ? 1 : 0) : v);
    for (const [k, v] of Object.entries(d.v2 ?? {})) gl.uniform2f(p.loc(k), v[0], v[1]);
    for (const [k, v] of Object.entries(d.v3 ?? {})) gl.uniform3f(p.loc(k), v[0]!, v[1]!, v[2]!);
    for (const [k, v] of Object.entries(d.iv2 ?? {})) gl.uniform2i(p.loc(k), v[0], v[1]);
    for (const [k, v] of Object.entries(d.m3 ?? {})) gl.uniformMatrix3fv(p.loc(k), false, v);
    // 샘플러: 지정되지 않은(생략된 단계) 샘플러에는 1×1 더미(값 0)를 바인딩한다
    for (const [name, s] of p.samplers) {
      const t = d.tex?.[name] ?? null;
      const tex = t === null ? (s.kind === "3d" ? this.dummy3D : this.dummy2D) : "fbo" in (t as object) ? (t as Target).tex : (t as WebGLTexture);
      gl.activeTexture(gl.TEXTURE0 + s.unit);
      gl.bindTexture(s.kind === "3d" ? gl.TEXTURE_3D : gl.TEXTURE_2D, tex);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.passes++;
  }

  // ── 공통 유니폼 ──────────────────────────────────────────────────────────
  private lib(c: ChainParams, core: Target | null, halo: Target | null, trans: Target | null, atm: Vec3, size: Sized, tileOrigin: readonly [number, number] = [0, 0], imageSize: Sized = size) {
    return {
      f: { uDehaze: c.s.uDehaze, uKe: c.s.uKe, uKb: c.s.uKb },
      i: { uHdf: c.hdf, uMono: c.mono, uCurveOn: c.curve.on },
      v2: { uDstSize: [size.width, size.height] as const, uTileOrigin: tileOrigin, uImageSize: [imageSize.width, imageSize.height] as const },
      v3: { uAtm: atm },
      tex: { uCore: core, uHalo: halo, uTrans: trans, uCurve: c.curve.tex } as Record<string, TexLike | null>,
    };
  }

  private merge(base: ReturnType<RenderGraph["lib"]>, d: Omit<DrawSpec, "pass" | "target" | "size"> & Pick<DrawSpec, "pass" | "target" | "size">): DrawSpec {
    return {
      pass: d.pass, target: d.target, size: d.size,
      f: { ...base.f, ...d.f }, i: { ...base.i, ...d.i }, v2: { ...base.v2, ...d.v2 }, v3: { ...base.v3, ...d.v3 },
      iv2: d.iv2, m3: d.m3, tex: { ...base.tex, ...d.tex },
    };
  }

  private normalize(c: ChainParams, R: Size, srcTex: WebGLTexture, srcSize: Size, orient: number, out: Target): void {
    const n = c.norm;
    this.draw({
      pass: "normalize", target: out, size: R,
      v2: { uDstSize: [R.width, R.height], uSrcSize: [srcSize.width, srcSize.height], uTileOrigin: [0, 0], uImageSize: [R.width, R.height] },
      i: { uOrient: orient, uProfile: n.profile, uLimitedCV: n.limitedCV, uSrcLutN: n.srcLut?.N ?? 2, uSrcLutInVR: n.srcLut?.inVR ?? false, uSrcLutOutVR: n.srcLut?.outVR ?? false, uSamsungFix: n.samsungFix, uRgc: n.rgc, uRolloff: n.rolloff },
      f: { uRawScale: n.rawScale, uExpGain: c.s.uExpGain },
      m3: { uSrcToWS: n.srcToWS, uWB: n.wb },
      tex: { uSrc: srcTex, uToneInv: this.toneInvTex, uSrcLut: n.srcLut?.tex ?? null },
    });
  }

  toneInvTex: WebGLTexture | null = null;

  /** HDF: L1 추출 → 2×2 피라미드 → 레벨별 분리 가우시안. wantHalo=false 면 core 만 */
  private hdf(c: ChainParams, ws: Target, R: Size, plan: HdfPlan, wantHalo: boolean): { core: Target; halo: Target | null } {
    const maxLevel = wantHalo ? plan.maxLevel : plan.core.level;
    const levels: Target[] = [];
    const L1 = levelSize(R, 1);
    const l1 = this.pool.acquire(L1.width, L1.height, "rgba16f");
    this.draw({ pass: "hdf_extract", target: l1, size: L1, iv2: { uWSSize: [R.width, R.height] }, tex: { uWS: ws }, v2: { uDstSize: [L1.width, L1.height] } });
    levels.push(l1);
    for (let n = 2; n <= maxLevel; n++) {
      const prev = levels[n - 2]!;
      const S = levelSize(R, n);
      const t = this.pool.acquire(S.width, S.height, "rgba16f");
      this.draw({ pass: "down2", target: t, size: S, iv2: { uInSize: [prev.width, prev.height] }, tex: { uIn: prev } });
      levels.push(t);
    }
    const blur = (lv: { level: number; sigmaN: number; radius: number }, out: Target) => {
      const src = levels[lv.level - 1]!;
      const S = { width: src.width, height: src.height };
      const tmp = this.pool.acquire(S.width, S.height, "rgba16f");
      this.draw({ pass: "gauss", target: tmp, size: S, iv2: { uInSize: [S.width, S.height], uDir: [1, 0] }, f: { uSigma: lv.sigmaN }, i: { uRadius: lv.radius }, tex: { uIn: src } });
      this.draw({ pass: "gauss", target: out, size: S, iv2: { uInSize: [S.width, S.height], uDir: [0, 1] }, f: { uSigma: lv.sigmaN }, i: { uRadius: lv.radius }, tex: { uIn: tmp } });
      this.pool.release(tmp);
    };
    const cs = levelSize(R, plan.core.level);
    const core = this.pool.acquire(cs.width, cs.height, "rgba16f");
    blur(plan.core, core);
    let halo: Target | null = null;
    if (wantHalo) {
      const hs = levelSize(R, plan.halo.level);
      halo = this.pool.acquire(hs.width, hs.height, "rgba16f");
      blur(plan.halo, halo);
    }
    for (const t of levels) this.pool.release(t);
    return { core, halo };
  }

  /** 자기 가이드 필터: (p, p²) 입력 → box(r) → gf_ab(ε) → box(r) → out */
  private guided(inp: Target, S: Size, r: number, eps: number, out: Target): void {
    const box = (src: Target, dir: [number, number], dst: Target) =>
      this.draw({ pass: "box", target: dst, size: S, iv2: { uInSize: [S.width, S.height], uDir: dir }, i: { uRadius: r }, tex: { uIn: src } });
    const a = this.pool.acquire(S.width, S.height, "rg32f");
    const b = this.pool.acquire(S.width, S.height, "rg32f");
    box(inp, [1, 0], a);
    box(a, [0, 1], b);
    this.draw({ pass: "gf_ab", target: a, size: S, f: { uEps: eps }, tex: { uIn: b } });
    box(a, [1, 0], b);
    box(b, [0, 1], out);
    this.pool.release(a);
    this.pool.release(b);
  }

  private keep(name: keyof RenderGraph["persist"], w: number, h: number, fmt: Target["fmt"]): Target {
    const cur = this.persist[name];
    if (cur && cur.width === w && cur.height === h && cur.fmt === fmt) return cur;
    this.pool.release(cur);
    const t = this.pool.acquire(w, h, fmt);
    this.persist[name] = t;
    return t;
  }

  private drop(name: keyof RenderGraph["persist"]): void {
    this.pool.release(this.persist[name]);
    this.persist[name] = null;
  }

  // ── 미리보기 (사진 프록시·비디오) ─────────────────────────────────────────
  renderPreview(c: ChainParams, output: PreviewOutput, atmReq: AtmRequest, onAtm: (A: Vec3) => void): PreviewResult {
    this.passes = 0;
    const R = c.R;
    const sz = graphSizes(R, c.mode);
    const ws = this.pool.acquire(R.width, R.height, "rgba16f");
    // 1. normalize
    this.normalize(c, R, c.src.tex, c.src.size, c.src.orient, ws);
    // 2. HDF
    let core: Target | null = null;
    let halo: Target | null = null;
    if (c.hdf) {
      const r = this.hdf(c, ws, R, c.hdfPlan, true);
      core = r.core;
      halo = r.halo;
      this.drop("tHalo");
      this.persist.tHalo = halo;
    } else this.drop("tHalo");
    // 3. 디헤이즈
    let atm = atmReq.value;
    let dzA: Target | null = null;
    let trans: Target | null = null;
    if (c.s.uDehaze !== 0) {
      const D = sz.D;
      const libD = this.lib(c, core, halo, null, atm, D);
      if (atmReq.refresh !== "none") {
        dzA = this.pool.acquire(D.width, D.height, "rgba16f");
        this.draw(this.merge(libD, { pass: "prep", target: dzA, size: D, i: { uMode: 1 }, v2: { uSrcPx: [R.width, R.height] }, tex: { uWS: ws } }));
        if (atmReq.refresh === "sync") {
          const px = readFloatRGBA(this.gl, dzA);
          atm = computeAtmosphere(px, D.width, D.height);
          onAtm(atm);
          this.pool.release(dzA);
          dzA = null;
        }
      }
      const libA = this.lib(c, core, halo, null, atm, D);
      const ratio = this.pool.acquire(D.width, D.height, "r16f");
      this.draw(this.merge(libA, { pass: "prep", target: ratio, size: D, i: { uMode: 2 }, v2: { uSrcPx: [R.width, R.height] }, tex: { uWS: ws } }));
      const tmp = this.pool.acquire(D.width, D.height, "r16f");
      const mn = this.pool.acquire(D.width, D.height, "r16f");
      this.draw({ pass: "min7", target: tmp, size: D, iv2: { uInSize: [D.width, D.height], uDir: [1, 0] }, tex: { uIn: ratio } });
      this.draw({ pass: "min7", target: mn, size: D, iv2: { uInSize: [D.width, D.height], uDir: [0, 1] }, tex: { uIn: tmp } });
      this.pool.release(ratio);
      this.pool.release(tmp);
      const tt = this.pool.acquire(D.width, D.height, "rg32f");
      this.draw({ pass: "dz_tt", target: tt, size: D, tex: { uMinTex: mn } });
      const ab = this.pool.acquire(D.width, D.height, "rg32f");
      this.guided(tt, D, sz.rDz, 0.001, ab);
      this.pool.release(tt);
      trans = this.keep("tTrans", D.width, D.height, "r16f");
      this.draw({ pass: "dz_q", target: trans, size: D, tex: { uMinTex: mn, uAB: ab } });
      this.pool.release(ab);
      this.pool.release(mn);
    } else this.drop("tTrans");
    // 4. 베이스 톤
    let toneAB: Target | null = null;
    if (c.toneOps) {
      const A = sz.A;
      const libA = this.lib(c, core, halo, trans, atm, A);
      const p = this.pool.acquire(A.width, A.height, "rg32f");
      this.draw(this.merge(libA, { pass: "prep", target: p, size: A, i: { uMode: 0 }, v2: { uSrcPx: [R.width, R.height] }, tex: { uWS: ws } }));
      toneAB = this.keep("tToneAB", A.width, A.height, "rg16f");
      this.guided(p, A, sz.rT, 0.25, toneAB);
      this.pool.release(p);
    } else this.drop("tToneAB");
    // 5. main
    const main = this.pool.acquire(R.width, R.height, "rgba16f");
    this.mainPass(c, main, R, ws, core, halo, trans, toneAB, atm, [0, 0], R);
    this.pool.release(ws);
    if (core) this.pool.release(core);
    // 6. 명료도
    let clarAB: Target | null = null;
    if (c.s.uClarity !== 0) {
      const A = sz.A;
      const libA = this.lib(c, null, null, null, atm, A);
      const p = this.pool.acquire(A.width, A.height, "rg32f");
      this.draw(this.merge(libA, { pass: "prep", target: p, size: A, i: { uMode: 3 }, v2: { uSrcPx: [R.width, R.height] }, tex: { uMainTex: main } }));
      clarAB = this.keep("tClarAB", A.width, A.height, "rg16f");
      this.guided(p, A, sz.rC, 0.004, clarAB);
      this.pool.release(p);
    } else this.drop("tClarAB");
    // 7. post
    const post = this.pool.acquire(R.width, R.height, "rgba16f");
    this.postPass(c, post, R, main, clarAB, [0, 0], R);
    this.pool.release(main);
    // 8. 선명도
    const blurL = this.sharpenBlur(c, post, R);
    // 9. final
    let probeTarget: Target | null = null;
    if (output.kind === "canvas") {
      this.finalPass(c, null, R, post, blurL, { flipY: true, dither: true, crop: [0, 0], imgPxOrigin: [0, 0] });
    } else {
      probeTarget = this.pool.acquire(R.width, R.height, "rgba16f");
      this.finalPass(c, probeTarget, R, post, blurL, { flipY: false, dither: false, crop: [0, 0], imgPxOrigin: [0, 0] });
    }
    this.pool.release(post);
    this.pool.release(blurL);
    return { passes: this.passes, atm, probeTarget, dzA };
  }

  private mainPass(c: ChainParams, out: Target, size: Size, ws: Target, core: Target | null, halo: Target | null, trans: Target | null, toneAB: Target | null, atm: Vec3, tileOrigin: [number, number], imageSize: Size): void {
    const L = c.lut;
    this.draw(this.merge(this.lib(c, core, halo, trans, atm, size, tileOrigin, imageSize), {
      pass: "main", target: out, size,
      i: { uToneOps: c.toneOps, uLutMode: L.mode, uLutN: L.N, uLutDomain: L.domain, uLutInVR: L.inVR, uLutOutVR: L.outVR },
      f: { uSh: c.s.uSh, uHi: c.s.uHi, uWh: c.s.uWh, uBk: c.s.uBk, uBr: c.s.uBr, uLb: c.s.uLb, uCt: c.s.uCt, uVig: c.s.uVig },
      v3: { uLutDomMin: L.min, uLutDomMax: L.max },
      m3: { uWsToSG3C: c.wsToSG3C },
      tex: { uWS: ws, uToneAB: toneAB, uLut: L.tex },
    }));
  }

  private postPass(c: ChainParams, out: Target, size: Size, main: Target, clarAB: Target | null, tileOrigin: [number, number], imageSize: Size): void {
    this.draw(this.merge(this.lib(c, null, null, null, [0, 0, 0], size, tileOrigin, imageSize), {
      pass: "post", target: out, size,
      f: { uSat: c.s.uSat, uVib: c.s.uVib, uClarity: c.s.uClarity },
      tex: { uMainTex: main, uClarAB: clarAB },
    }));
  }

  private sharpenBlur(c: ChainParams, post: Target, size: Size): Target | null {
    if (!(c.s.uSharpen > 0)) return null;
    const h = this.pool.acquire(size.width, size.height, "r16f");
    const out = this.pool.acquire(size.width, size.height, "r16f");
    this.draw({ pass: "blurL", target: h, size, iv2: { uInSize: [size.width, size.height], uDir: [1, 0] }, i: { uChan: 3 }, tex: { uIn: post } });
    this.draw({ pass: "blurL", target: out, size, iv2: { uInSize: [size.width, size.height], uDir: [0, 1] }, i: { uChan: 0 }, tex: { uIn: h } });
    this.pool.release(h);
    return out;
  }

  private finalPass(c: ChainParams, target: Target | null, size: Size, post: Target, blurL: Target | null, o: { flipY: boolean; dither: boolean; crop: [number, number]; imgPxOrigin: [number, number] }): void {
    this.draw({
      pass: "final", target, size,
      v2: { uDstSize: [size.width, size.height], uGrainOff: c.grain.off, uCropOrigin: o.crop, uImgPxOrigin: o.imgPxOrigin, uTileOrigin: [0, 0], uImageSize: [size.width, size.height] },
      f: { uSharpen: c.s.uSharpen, uGrainAmt: c.s.uGrainAmt, uGrainScale: c.grain.scale },
      i: { uDither: o.dither, uFlipY: o.flipY },
      tex: { uPost: post, uBlurL: blurL },
    });
  }

  // ── 원본 해상도 타일 (섹션 12) ───────────────────────────────────────────
  renderTile(t: TileChain, srcTex: WebGLTexture, srcSize: Size): Uint8Array {
    this.passes = 0;
    const c = t.base;
    const R = t.R;
    const ws = this.pool.acquire(R.width, R.height, "rgba16f");
    this.normalize(c, R, srcTex, srcSize, 1, ws);
    let core: Target | null = null;
    if (c.hdf) core = this.hdf(c, ws, R, t.hdfPlan, false).core;
    const main = this.pool.acquire(R.width, R.height, "rgba16f");
    this.mainPass(c, main, R, ws, core, this.persist.tHalo, this.persist.tTrans, this.persist.tToneAB, t.atm, t.tileOrigin, t.imageSize);
    this.pool.release(ws);
    if (core) this.pool.release(core);
    const post = this.pool.acquire(R.width, R.height, "rgba16f");
    this.postPass(c, post, R, main, this.persist.tClarAB, t.tileOrigin, t.imageSize);
    this.pool.release(main);
    const blurL = this.sharpenBlur(c, post, R);
    const out = this.pool.acquire(t.out.width, t.out.height, "rgba8");
    this.finalPass(c, out, t.out, post, blurL, { flipY: false, dither: true, crop: t.crop, imgPxOrigin: t.imgPxOrigin });
    this.pool.release(post);
    this.pool.release(blurL);
    const gl = this.gl;
    const px = new Uint8Array(t.out.width * t.out.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(0, 0, t.out.width, t.out.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.pool.release(out);
    this.pool.deleteFree();
    return px;
  }
}

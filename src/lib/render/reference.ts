// 섹션 15.1 — 섹션 6 셰이더의 픽셀 단위 단계를 float64 로 똑같이 구현한 CPU 참조.
// S0, S4~S10, S13 그레인, S14 디더, gamutMap(16회, 1e-5). GPU↔CPU 프로브와 단위 테스트가 쓴다.
import {
  linToOklab, oklabToLin, shaperEnc, smoothstep as sstep, srgbDec, srgbEnc, tone, toneInv, wrap180,
} from "../color/fse/engine.mjs";
import { encodeLutInput } from "../color/fse/lut-domain.mjs";
import { tetraSample } from "../color/fse/tetra.mjs";
import * as T from "../color/source/transfer.mjs";
import { sampleCurve } from "./curve";
import { GRAIN_CLUSTER_MIX, GRAIN_CLUSTER_STD, GRAIN_FINE_STD, GRAIN_FLOOR, GRAIN_GAIN, GRAIN_TRI_NORM, GRAIN_W_CENTER, GRAIN_W_NEIGHBOR } from "./grain";
import { drShoulder, edgeSoftenL, filmShoulder, hdOp, rolloffW, zoneShadowPop } from "./isp-ops";
import { apply3, type Mat3 } from "./wb";

export type Vec3 = [number, number, number];
const DEG = Math.PI / 180;
const LUMA: Vec3 = [0.2126, 0.7152, 0.0722];
const sq = (x: number) => x * x;
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const map3 = (v: ArrayLike<number>, f: (x: number) => number): Vec3 => [f(v[0]!), f(v[1]!), f(v[2]!)];
export const luma709 = (x: ArrayLike<number>) => dot(LUMA, x);

// ── S0 ─────────────────────────────────────────────────────────────────────
/** uProfile 정수 → 디코드 (fs_normalize decodeLog) */
export function decodeLog(y: number, p: number): number {
  switch (p) {
    case 3: return T.slog3(y);
    case 4: return T.slog2(y);
    case 5: return T.flog(y);
    case 6: return T.flog2(y);
    case 7: return T.clog3(y);
    case 8: return T.vlog(y);
    case 9: return T.nlog(y);
    case 10: return T.dlog(y);
    case 11: return T.applelog(y);
    case 2: return T.hlg(y);
    case 14: return T.samsunglog(y);
    default: return y;
  }
}

export interface SourceLutRef { size: number; data: ArrayLike<number>; inVR: boolean; outVR: boolean }

export interface NormalizeCtx {
  profile: number;
  limitedCV: boolean;
  srcToWS: Mat3;
  rawScale: number;
  srcLut: SourceLutRef | null;
  samsungFix: boolean;
  rgc: boolean;
  rolloff: boolean;
  wb: Mat3;
  expGain: number;
  /** FSE-v2 §5-1 롤오프 상한 uRollW (기본 2.04 = DR100) */
  rollW?: number;
}

/** decodeToSrcLinear (GPU 는 Tref⁻¹ 를 4096칸 표로, CPU 참조는 48회 이분법 정확값) */
export function decodeToSrcLinear(v: ArrayLike<number>, c: NormalizeCtx): Vec3 {
  if (c.profile === 0) return map3(v, (x) => toneInv(Math.max(srgbDec(x), 0)));
  if (c.profile === 1) return map3(v, (x) => toneInv(Math.pow(clamp01(x), 2.4)));
  if (c.profile === 12) return map3(v, (x) => x * c.rawScale);
  if (c.profile === 13) {
    const L = c.srcLut;
    if (!L) throw new Error("소스 LUT 가 없습니다");
    let u = map3(v, clamp01);
    if (L.inVR) u = map3(u, (x) => x * (876 / 1023) + 64 / 1023);
    let o: Vec3 = tetraSample(L.data, L.size, u);
    if (L.outVR) o = map3(o, (x) => (x * 1023 - 64) / 876);
    return map3(o, (x) => toneInv(Math.pow(clamp01(x), 2.4)));
  }
  const y = c.limitedCV ? map3(v, (x) => (x * 876 + 64) / 1023) : map3(v, (x) => x);
  return map3(y, (x) => decodeLog(x, c.profile));
}

/** 섹션 5.2 Samsung Log 피부 마젠타 보정 (OKLab ab 2×2 행렬) */
export function samsungFix(x: ArrayLike<number>): Vec3 {
  const [L, a, b] = linToOklab(x);
  const C = Math.hypot(a, b);
  const h = Math.atan2(b, a) / DEG;
  const w = Math.exp(-0.5 * sq(wrap180(h - 50) / 16)) * sstep(0.02, 0.06, C) * (1 - sstep(0.85, 1.0, L));
  const th = 4 * w * DEG;
  const k = 1 - 0.04 * w;
  const a2 = k * (Math.cos(th) * a - Math.sin(th) * b);
  const b2 = k * (Math.sin(th) * a + Math.cos(th) * b);
  return oklabToLin(L, a2, b2);
}

function rgcCompress(d: number, lim: number, thr: number): number {
  if (d < thr) return d;
  const scl = (lim - thr) / Math.pow(Math.pow((1 - thr) / (lim - thr), -1.2) - 1, 1 / 1.2);
  const nd = (d - thr) / scl;
  return thr + (scl * nd) / Math.pow(1 + Math.pow(nd, 1.2), 1 / 1.2);
}

/** 섹션 5.3 소프트 색역 압축 (ACES 1.3 RGC) */
export function rgc(c: ArrayLike<number>): Vec3 {
  const ach = Math.max(c[0]!, c[1]!, c[2]!);
  if (ach <= 0) return [c[0]!, c[1]!, c[2]!];
  const d = map3(c, (x) => (ach - x) / ach);
  const cd: Vec3 = [rgcCompress(d[0], 1.147, 0.815), rgcCompress(d[1], 1.264, 0.803), rgcCompress(d[2], 1.312, 0.88)];
  return map3(cd, (x) => ach - x * ach);
}

/** 섹션 5.4 필름 하이라이트 롤오프 (FSE-v2: 상한 rollW = 2.04·2^drStops, 기본 DR100 = 2.04) */
export function rolloff(x: ArrayLike<number>, rollW = 2.04): Vec3 {
  return rolloffW(x, rollW);
}

/** fs_normalize 의 픽셀 경로(4탭 영역 표본 제외) */
export function normalizePixel(v: ArrayLike<number>, c: NormalizeCtx): Vec3 {
  let x = apply3(c.srcToWS, decodeToSrcLinear(v, c));
  if (c.samsungFix) x = samsungFix(x);
  if (c.rgc) x = rgc(x);
  if (c.rolloff) x = rolloff(x, c.rollW ?? 2.04);
  return map3(apply3(c.wb, x), (q) => q * c.expGain);
}

// ── S2~S6 ──────────────────────────────────────────────────────────────────
/** 섹션 5.7 디헤이즈 적용 */
export function dehazeApply(x: ArrayLike<number>, D: number, A: ArrayLike<number>, t: number): Vec3 {
  if (D === 0) return [x[0]!, x[1]!, x[2]!];
  let J: Vec3;
  if (D > 0) {
    const k = D / 100;
    const te = 1 + (Math.max(t, 0.1) - 1) * k;
    J = [(x[0]! - A[0]!) / te + A[0]!, (x[1]! - A[1]!) / te + A[1]!, (x[2]! - A[2]!) / te + A[2]!];
  } else {
    const k = -D / 100;
    J = [x[0]! + (A[0]! - x[0]!) * 0.4 * k, x[1]! + (A[1]! - x[1]!) * 0.4 * k, x[2]! + (A[2]! - x[2]!) * 0.4 * k];
  }
  return map3(J, (q) => Math.max(q, 0));
}

export interface ToneSliders { sh: number; hi: number; wh: number; bk: number; br: number; lb: number }

/** 섹션 5.8 베이스 레이어 톤. ab = 가이드 필터 (mean_a, mean_b) — Bs = a·Yl + b. isp = FSE-v2 §5-4 ZS 암부 밀도(sd)·3D 팝(pop) */
export function baseTone(x: ArrayLike<number>, ab: [number, number], s: ToneSliders, isp: { sd: number; pop: number } = { sd: 0, pop: 0 }): Vec3 {
  const Y = dot(LUMA, x);
  if (Y <= 2 ** -20) return [x[0]!, x[1]!, x[2]!];
  const Yl = Math.log2(Y);
  const Bs = ab[0] * Yl + ab[1];
  const Dt = Yl - Bs;
  const e = Bs - Math.log2(0.18);
  const msh = Math.exp(-0.5 * sq((e + 3) / 1.5));
  const mhi = sstep(-0.5, 2.5, e);
  const mwh = sstep(1.5, 3.8, e);
  const mbk = 1 - sstep(-7, -3, e);
  const mmid = Math.exp(-0.5 * sq(e / 1.8));
  const z = zoneShadowPop(Bs, Dt, isp.sd, isp.pop);
  const dB = 1.5 * s.sh * msh + 1.5 * s.hi * mhi + s.wh * mwh + s.bk * mbk + s.br * mmid + 1.2 * s.lb * (msh - mhi) + z.dB;
  const Yp = Math.pow(2, Bs + dB + z.Dt);
  return map3(x, (v) => v * (Yp / Y));
}

/** 섹션 5.8 대비 (uCt ∈ [−1,1]) */
export function contrastOp(x: ArrayLike<number>, ct: number): Vec3 {
  const Y = dot(LUMA, x);
  if (Y <= 2 ** -20) return [x[0]!, x[1]!, x[2]!];
  const e = Math.log2(Y) - Math.log2(0.18);
  const Yp = 0.18 * Math.pow(2, e * (1 + 0.5 * ct));
  return map3(x, (v) => v * (Yp / Y));
}

/** 섹션 5.9 cos⁴θ 비네팅 계수 */
export function vignetteF(u: number, v: number, aspect: number, Vg: number): number {
  const px = (u - 0.5) * aspect, py = v - 0.5;
  const r = Math.hypot(px, py) / Math.hypot(aspect * 0.5, 0.5);
  const k = Math.abs(Vg) / 100;
  const q = 1 + (r * k) * (r * k);
  const f = 1 / (q * q);
  return Vg < 0 ? f : 1 / f;
}

/** 섹션 5.10 S6 음수 제거 */
export function clipNeg(x: ArrayLike<number>): Vec3 {
  const n = Math.min(x[0]!, x[1]!, x[2]!);
  if (n >= 0) return [x[0]!, x[1]!, x[2]!];
  const Y = dot(LUMA, x);
  if (Y <= 0) return [0, 0, 0];
  const t = Y / (Y - n);
  return map3(x, (v) => Y + t * (v - Y));
}

// ── S7 ─────────────────────────────────────────────────────────────────────
export type LutDomainName = "srgb-display" | "rec709-bt1886" | "fsh-v1" | "slog3-sgamut3cine";
export type LutStageRef =
  | { mode: 0 }
  | { mode: 1; size: number; data: ArrayLike<number> }
  | { mode: 2; size: number; data: ArrayLike<number>; domain: LutDomainName; inVR: boolean; outVR: boolean; domMin: Vec3; domMax: Vec3 };

/** 원본 모드: srgbEnc(toneRef(x)) */
export const originalEnc = (x: ArrayLike<number>): Vec3 => map3(x, (v) => srgbEnc(tone(v)));

/** Step 4 §5-3: 필름 없음(T_ref) 과 필름 출력을 디스플레이 선형광에서 섞는다 (lutStage 의 JS 미러) */
export function filmStrengthMix(vNone: ArrayLike<number>, vSim: ArrayLike<number>, k: number): Vec3 {
  if (k >= 1) return [vSim[0]!, vSim[1]!, vSim[2]!];
  const t = clamp01(k);
  return [0, 1, 2].map((i) => srgbEnc(srgbDec(vNone[i]!) * (1 - t) + srgbDec(vSim[i]!) * t)) as Vec3;
}

export function lutStage(x: ArrayLike<number>, L: LutStageRef): Vec3 {
  if (L.mode === 0) return originalEnc(x);
  if (L.mode === 1) return tetraSample(L.data, L.size, map3(x, shaperEnc));
  let u: Vec3 = encodeLutInput(L.domain, x);
  if (L.inVR) u = map3(u, (q) => q * (876 / 1023) + 64 / 1023);
  u = [(u[0] - L.domMin[0]) / (L.domMax[0] - L.domMin[0]), (u[1] - L.domMin[1]) / (L.domMax[1] - L.domMin[1]), (u[2] - L.domMin[2]) / (L.domMax[2] - L.domMin[2])];
  let o: Vec3 = tetraSample(L.data, L.size, u);
  if (L.outVR) o = map3(o, (q) => (q * 1023 - 64) / 876);
  return map3(o, clamp01);
}

// ── gamutMap (GPU 판: 16회, 1e-5) ──────────────────────────────────────────
const inGamut = (c: Vec3) => c.every((v) => v >= -1e-5 && v <= 1 + 1e-5);

export function gamutMap16(L0: number, a: number, b: number): Vec3 {
  const L = clamp01(L0);
  const C = Math.hypot(a, b);
  if (C < 1e-9) return map3(oklabToLin(L, 0, 0), clamp01);
  const da = a / C, db = b / C;
  let lo = 0, hi = 0.5;
  for (let i = 0; i < 16; i++) {
    const m = 0.5 * (lo + hi);
    if (inGamut(oklabToLin(L, da * m, db * m))) lo = m; else hi = m;
  }
  const t = 0.85 * lo;
  let Co = C;
  if (C > t) { const r = lo - t; Co = r > 1e-9 ? t + r * Math.tanh((C - t) / r) : t; }
  return map3(oklabToLin(L, da * Co, db * Co), clamp01);
}

// ── S8~S12 ─────────────────────────────────────────────────────────────────
const toLab = (v: ArrayLike<number>) => linToOklab(map3(v, srgbDec));

/** 섹션 5.11 컬러 크롬 이펙트 / FX 블루 */
export function cceOp(v: ArrayLike<number>, ke: number, kb: number): Vec3 {
  const [L, a, b] = toLab(v);
  const C = Math.hypot(a, b);
  const h = Math.atan2(b, a) / DEG;
  const blue = Math.exp(-0.5 * sq(wrap180(h - 264) / 28));
  const me = sstep(0.08, 0.2, C) * (1 - blue) * sstep(0.3, 0.7, L);
  const mb = sstep(0.05, 0.16, C) * blue * sstep(0.2, 0.6, L);
  const L2 = Math.pow(Math.max(L, 0), 1 + ke * me + kb * mb);
  return map3(gamutMap16(L2, a, b), srgbEnc);
}

/** 섹션 5.12 채널별 커브 */
export const applyCurve = (v: ArrayLike<number>, T: ArrayLike<number>): Vec3 => map3(v, (x) => sampleCurve(T, x));

/** fs_post 의 채도·생동감·명료도 (명료도 ab = 가이드 필터 계수, null 이면 명료도 생략) */
export function postChroma(v: ArrayLike<number>, sat: number, vib: number, clarity: number, clarAB: [number, number] | null, monoTint: [number, number] | null = null): Vec3 {
  const tint = monoTint !== null && (monoTint[0] !== 0 || monoTint[1] !== 0);
  const chroma = sat !== 0 || vib !== 0;
  const clar = clarity !== 0 && clarAB !== null;
  if (!tint && !chroma && !clar) return [v[0]!, v[1]!, v[2]!];
  let [L, a, b] = toLab(v);
  if (tint) {
    // Step 4 §5-4 흑백 조색: lab.yz += uMonoTint · sstep(0,0.25,L) · (1 − sstep(0.85,1,L))
    const w = sstep(0, 0.25, L) * (1 - sstep(0.85, 1, L));
    a += monoTint![0] * w;
    b += monoTint![1] * w;
  }
  if (chroma) {
    const C = Math.hypot(a, b);
    const h = Math.atan2(b, a) / DEG;
    const C1 = C * (1 + sat / 100);
    const skin = Math.exp(-0.5 * sq(wrap180(h - 55) / 20));
    const g = vib >= 0 ? 1 + (vib / 100) * (1 - sstep(0, 0.2, C)) * (1 - 0.5 * skin) : 1 + (vib / 100) * (1 - 0.5 * sstep(0, 0.2, C));
    const C2 = Math.max(0, C1 * g);
    if (C > 1e-9) { a *= C2 / C; b *= C2 / C; } else { a = 0; b = 0; }
  }
  if (clar && clarAB) L = clarityL(L, clarAB[0] * L + clarAB[1], clarity);
  return map3(gamutMap16(L, a, b), srgbEnc);
}

/** 섹션 5.13 L' = L + 1.2(Cl/100)(L−base)·4L(1−L) */
export const clarityL = (L: number, base: number, Cl: number) => L + 1.2 * (Cl / 100) * (L - base) * 4 * L * (1 - L);

/** 섹션 5.14 L' = L + (Sh/100)·1.2·D', D' = sign(D)·max(|D|−0.004, 0). FSE-v2 §5-5: − es·sstep(0.012, 0.045, |D|)·D */
export function sharpenL(L: number, blur: number, Sh: number, es = 0): number {
  const D = L - blur;
  const Dp = Math.sign(D) * Math.max(Math.abs(D) - 0.004, 0);
  return edgeSoftenL(L + (Sh / 100) * 1.2 * Dp, D, es);
}

// ── S13 그레인 (픽셀 격자 삼각 PDF 백색 노이즈 + 짧은 커널, docs/COLOR_SCIENCE.md §16.13) ──
/** 셀 (ix, iy) 의 삼각 PDF 노이즈, 표준편차 1. pcg3d 의 x, y 두 성분을 균등난수 2개로 쓴다 (GPU 와 같은 값) */
export function cellTri(ix: number, iy: number, seed: number): number {
  const h = pcg3d(ix >>> 0, iy >>> 0, seed);
  return (h[0] / 4294967296 + h[1] / 4294967296 - 1) * GRAIN_TRI_NORM;
}

/** 소 커널: 중심 70% + 상하좌우 4셀 각 7.5%, 표준편차 1 로 정규화 */
function fineGrain(cx: number, cy: number): number {
  const s = GRAIN_W_CENTER * cellTri(cx, cy, 0)
    + GRAIN_W_NEIGHBOR * (cellTri(cx - 1, cy, 0) + cellTri(cx + 1, cy, 0) + cellTri(cx, cy - 1, 0) + cellTri(cx, cy + 1, 0));
  return s / GRAIN_FINE_STD;
}

/** 대 클러스터: 독립 노이즈(seed 1)의 3×3 가중합 [1 2 1; 2 4 2; 1 2 1]/16, 표준편차 1 로 정규화 */
function clusterGrain(cx: number, cy: number): number {
  let s = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += (2 - Math.abs(dx)) * (2 - Math.abs(dy)) * cellTri(cx + dx, cy + dy, 1);
  return s / 16 / GRAIN_CLUSTER_STD;
}

/**
 * 섹션 5.15 은염 입자 n — px = 이미지 픽셀 중심 좌표, 셀 = floor(px/scale + off)
 * coarse = 0 (크기 소): 고주파 미세 입자만. coarse = 1 (크기 대): 미세 45% + 3×3 클러스터 55% 를 중첩 (표준편차 1 로 재정규화).
 * 저주파 격자 보간이 없으므로 입자를 키워도 흐린 얼룩이 생기지 않는다. 색 성분 없이 스칼라 하나(루미넌스 농도 변조).
 */
export function grainNoise(pxX: number, pxY: number, scale: number, off: [number, number], coarse = 0): number {
  const cx = Math.floor(pxX / scale + off[0]), cy = Math.floor(pxY / scale + off[1]);
  const f = fineGrain(cx, cy);
  if (coarse <= 0) return f;
  const wc = GRAIN_CLUSTER_MIX * coarse, wf = 1 - wc;
  return (wf * f + wc * clusterGrain(cx, cy)) / Math.sqrt(wf * wf + wc * wc);
}

export function grainApply(v: ArrayLike<number>, amount: number, n: number): Vec3 {
  const vl = dot(LUMA, v);
  const resp = GRAIN_FLOOR + (1 - GRAIN_FLOOR) * Math.max(4 * vl * (1 - vl), 0);
  return map3(v, (x) => clamp01(x + GRAIN_GAIN * (amount / 100) * resp * n));
}

// ── S14 디더 ──────────────────────────────────────────────────────────────
export function pcg3d(x: number, y: number, z: number): [number, number, number] {
  let a = (Math.imul(x >>> 0, 1664525) + 1013904223) >>> 0;
  let b = (Math.imul(y >>> 0, 1664525) + 1013904223) >>> 0;
  let c = (Math.imul(z >>> 0, 1664525) + 1013904223) >>> 0;
  a = (a + Math.imul(b, c)) >>> 0; b = (b + Math.imul(c, a)) >>> 0; c = (c + Math.imul(a, b)) >>> 0;
  a = (a ^ (a >>> 16)) >>> 0; b = (b ^ (b >>> 16)) >>> 0; c = (c ^ (c >>> 16)) >>> 0;
  a = (a + Math.imul(b, c)) >>> 0; b = (b + Math.imul(c, a)) >>> 0; c = (c + Math.imul(a, b)) >>> 0;
  return [a, b, c];
}

/** v8 = round(clamp(v + (n1+n2−1)/255)·255) — 정수 픽셀 좌표 (x,y) */
export function dither8(v: ArrayLike<number>, x: number, y: number): Vec3 {
  const n1 = pcg3d(x, y, 0)[0] / 4294967296;
  const n2 = pcg3d(x, y, 1)[0] / 4294967296;
  return map3(v, (q) => Math.floor(clamp01(q + (n1 + n2 - 1) / 255) * 255 + 0.5));
}

// ── 공간 단계를 끈 전체 픽셀 경로 (GPU↔CPU 프로브) ─────────────────────────
export interface PixelCtx {
  norm: NormalizeCtx;
  ct: number;
  vig: number;
  aspect: number;
  lut: LutStageRef;
  mono: boolean;
  ke: number;
  kb: number;
  curve: ArrayLike<number> | null;
  sat: number;
  vib: number;
  grain: { amount: number; scale: number; off: [number, number]; coarse?: number } | null;
  /** Step 4: 필름 강도 0..1 (기본 1), 흑백 조색 uMonoTint (mono 일 때만 적용) */
  filmStrength?: number;
  monoTint?: [number, number];
  /** FSE-v2 카메라 ISP 픽셀 단계: S6b 필름 숄더(drStops, sceneRef), S7b 하이라이트 밀도(hd). 공간 단계(MH, ZS·팝, ES)는 프로브에서 꺼진다 */
  isp?: { drStops: number; sceneRef: boolean; hd: number; /** 표시 기준 소스의 D레인지 숄더 (생략 = 꺼짐) */ drY0?: number; drS?: number };
}

/** v = 소스 텍셀, (u, vv) = 전역 uv, (pxX, pxY) = 이미지 픽셀 중심 좌표 */
export function pixelPipeline(v: ArrayLike<number>, u: number, vv: number, pxX: number, pxY: number, c: PixelCtx): Vec3 {
  return pixelPipelineFromWs(normalizePixel(v, c.norm), u, vv, pxX, pxY, c);
}

/** S0(소스→WS·WB·노출) 이후 픽셀 경로. x = 노출까지 적용된 WS 선형 RGB */
export function pixelPipelineFromWs(x0: ArrayLike<number>, u: number, vv: number, pxX: number, pxY: number, c: PixelCtx): Vec3 {
  let x: Vec3 = [x0[0]!, x0[1]!, x0[2]!];
  if (c.ct !== 0) x = contrastOp(x, c.ct);
  if (c.vig !== 0) { const f = vignetteF(u, vv, c.aspect, c.vig); x = map3(x, (q) => q * f); }
  x = clipNeg(x);
  if (c.isp) x = drShoulder(filmShoulder(x, c.isp.drStops, c.isp.sceneRef), c.isp.drY0 ?? 0, c.isp.drS ?? 0);
  let o = lutStage(x, c.lut);
  if (c.lut.mode !== 0 && (c.filmStrength ?? 1) < 1) o = filmStrengthMix(originalEnc(x), o, c.filmStrength ?? 1);
  if (c.isp && c.isp.hd > 0) o = hdOp(o, c.isp.hd, gamutMap16);
  if (!c.mono && (c.ke > 0 || c.kb > 0)) o = cceOp(o, c.ke, c.kb);
  if (c.curve) o = applyCurve(o, c.curve);
  o = postChroma(o, c.sat, c.vib, 0, null, c.mono ? (c.monoTint ?? null) : null);
  if (c.grain && c.grain.amount > 0) o = grainApply(o, c.grain.amount, grainNoise(pxX, pxY, c.grain.scale, c.grain.off, c.grain.coarse ?? 0));
  return o;
}

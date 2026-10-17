// FSE-v2 카메라 ISP 6단계의 CPU 미러 (COLOR_SCIENCE §Camera ISP 5-1~5-5). 셰이더(fs_main, lib_ops, fs_normalize, fs_final)와 같은 수식이다.
// 상수는 isp.ts 한 곳에서 읽는다. gamutMap 은 호출자가 고른다(GPU 미러 = reference.gamutMap16, 골든 = engine.gamutMap 24회).
import { linToOklab, smoothstep as sstep, srgbDec, srgbEnc } from "../color/fse/engine.mjs";
import { ISP_UO, ISP_Y88, ISP_YK } from "./isp";

export type Vec3 = [number, number, number];
type GamutMap = (L: number, a: number, b: number) => ArrayLike<number>;
const LUMA: Vec3 = [0.2126, 0.7152, 0.0722];
const sq = (x: number) => x * x;
const lumaPos = (x: ArrayLike<number>) => LUMA[0] * Math.max(x[0]!, 0) + LUMA[1] * Math.max(x[1]!, 0) + LUMA[2] * Math.max(x[2]!, 0);
const scale3 = (x: ArrayLike<number>, k: number): Vec3 => [x[0]! * k, x[1]! * k, x[2]! * k];

/** 5-1 S0 롤오프 (상한 uRollW = 2.04·2^drStops). tanh 인자는 GLSL 과 같게 15 로 묶는다(고휘도 GPU NaN 가드, float32 에서 결과 동일) */
export function rolloffW(x: ArrayLike<number>, rollW: number): Vec3 {
  const Y = lumaPos(x);
  if (Y <= 1) return [x[0]!, x[1]!, x[2]!];
  const Yp = 1 + (rollW - 1) * Math.tanh(Math.min((Y - 1) / (rollW - 1), 15));
  return scale3(x, Yp / Y);
}

/** 5-1 FS-DR 필름 숄더 (S6b, scene-linear, 색비 보존) */
export function filmShoulder(x: ArrayLike<number>, drStops: number, sceneRef: boolean): Vec3 {
  if (drStops <= 0) return [x[0]!, x[1]!, x[2]!];
  const Y = lumaPos(x);
  if (Y <= ISP_YK) return [x[0]!, x[1]!, x[2]!];
  const Ui = sceneRef ? ISP_UO + drStops : ISP_UO;
  const u = Math.log2(Y / ISP_YK);
  const up = u >= Ui ? ISP_UO : ISP_UO * (1 - Math.pow(1 - u / Ui, Ui / ISP_UO));
  return scale3(x, (ISP_YK * Math.pow(2, up)) / Y);
}

/** 5-2 HD 명도 곡선: L ≤ 0.70 항등, 그 위 L' = 0.70 + 0.30·(t − hd·t²(1−t)²) */
export function hdL(L: number, hd: number): number {
  if (L <= 0.7) return L;
  const t = Math.min(1, (L - 0.7) / 0.3);
  return 0.7 + 0.3 * (t - hd * t * t * sq(1 - t));
}

/** 5-2 HD 하이라이트 밀도 (S7b, 디스플레이 sRGB 인코드 v) */
export function hdOp(v: ArrayLike<number>, hd: number, gm: GamutMap): Vec3 {
  const lab = linToOklab([srgbDec(v[0]!), srgbDec(v[1]!), srgbDec(v[2]!)]);
  if (lab[0] <= 0.7) return [v[0]!, v[1]!, v[2]!];
  const o = gm(hdL(lab[0], hd), lab[1], lab[2]);
  return [srgbEnc(o[0]!), srgbEnc(o[1]!), srgbEnc(o[2]!)];
}

/** 5-3 마이크로 할레이션 방출원 */
export function emitMh(x: ArrayLike<number>): Vec3 {
  const c: Vec3 = [Math.max(x[0]!, 0), Math.max(x[1]!, 0), Math.max(x[2]!, 0)];
  return scale3(c, sstep(ISP_Y88, 2.04, lumaPos(c)));
}

/** 5-3 합성: x' = x + mh·(tint ⊙ B − 0.25·emitMh(x)) */
export function mhComposite(x: ArrayLike<number>, B: ArrayLike<number>, mh: number, tint: ArrayLike<number>): Vec3 {
  if (mh <= 0) return [x[0]!, x[1]!, x[2]!];
  const e = emitMh(x);
  return [0, 1, 2].map((i) => x[i]! + mh * (tint[i]! * B[i]! - 0.25 * e[i]!)) as Vec3;
}

/** 5-4 ZS·3D 팝: 베이스 Bs·디테일 Dt(log2) → 변경된 dB 성분과 Dt' (슬라이더 항 dB0 는 호출자가 계산) */
export function zoneShadowPop(Bs: number, Dt: number, sd: number, pop: number): { dB: number; Dt: number } {
  const e = Bs - Math.log2(0.18);
  const msd = Math.exp(-0.5 * sq((e + 3.5) / 1.0));
  const mz = Math.exp(-0.5 * sq((e + 1.5) / 1.2));
  return { dB: -sd * msd, Dt: Dt + (pop * mz * Dt) / (1 + sq(Dt / 0.6)) };
}

/** 5-5 ES 광학 윤곽 완화 (선명도 항 제외): L' = L − es·sstep(0.012, 0.045, |D|)·D */
export function edgeSoftenL(L: number, D: number, es: number): number {
  return L - es * sstep(0.012, 0.045, Math.abs(D)) * D;
}

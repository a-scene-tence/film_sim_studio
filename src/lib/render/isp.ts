// src/lib/render/isp.ts — FSE-v2 카메라 ISP 상수와 유니폼 계산 (브랜드 렌더링 근사)
export type IspBrand = 'fujifilm' | 'ricoh';
export type IspProfile = { hd: number; mh: number; mhTint: [number, number, number]; sd: number; pop: number; es: number };
export const ISP_PROFILES: Record<IspBrand, IspProfile> = {
  fujifilm: { hd: 1.2, mh: 0.1, mhTint: [1.0, 0.78, 0.58], sd: 0.3, pop: 0.25, es: 0.35 },
  ricoh: { hd: 0.9, mh: 0.07, mhTint: [1.0, 0.86, 0.72], sd: 0.45, pop: 0.35, es: 0.25 },
};
export const ISP_YK = 0.328679008; // T_ref 디스플레이 L = 0.70 이 되는 scene Y
export const ISP_Y88 = 0.840607362; // T_ref 디스플레이 L = 0.88 이 되는 scene Y
export const ISP_UO = 2.63381793; // log2(2.04 / ISP_YK)
export const MH_SIGMA_FRAC = 0.001; // 마이크로 할레이션 σ = 0.0010 · hypot(이미지 폭, 높이) [이 렌더의 px 단위]
export const PROCESSED_PROFILES: ReadonlySet<number> = new Set([0, 1]); // 카메라·폰이 이미 샤프닝한 소스(sRGB 이미지, Rec.709 영상)
export const DISPLAY_REFERRED_PROFILES: ReadonlySet<number> = new Set([0, 1, 13]); // 하이라이트 여유 없는 소스
export type DRange = 100 | 200 | 400;
/**
 * 표시 기준(JPEG·PNG·Rec.709 영상) 소스의 D레인지 숄더. Y > y0 에서 Y' = y0 + s·nd/√(1+nd²), nd = (Y−y0)/s (y0 에서 기울기 1, 점근선 y0+s).
 * DR200: 중상위 휘도(Y > 0.45)부터, DR400: 미드톤(Y > 0.30)부터 더 폭넓게 감는다. RAW·Log 는 기존 filmShoulder(헤드룸 활용)가 맡는다.
 */
export const DR_SHOULDER: Readonly<Record<200 | 400, { y0: number; s: number }>> = { 200: { y0: 0.45, s: 0.75 }, 400: { y0: 0.3, s: 0.6 } };
export type IspUniforms = {
  uIspHd: number; uIspMh: number; uIspMhTint: [number, number, number]; uIspSd: number; uIspPop: number; uIspEs: number;
  uDrStops: number; uSceneRef: boolean; uRollW: number;
  /** 표시 기준 소스의 D레인지 숄더 (uDrS = 0 이면 꺼짐) */
  uDrY0: number; uDrS: number;
};
export function drStops(dRange: DRange): number {
  return dRange === 400 ? 2 : dRange === 200 ? 1 : 0;
}
export function ispUniforms(args: { brand: IspBrand | null; filmStrength: number; dRange: DRange; profile: number; renderScale: number }): IspUniforms {
  const st = args.brand ? Math.min(1, Math.max(0, args.filmStrength / 100)) : 0;
  const P = args.brand ? ISP_PROFILES[args.brand] : null;
  const k = drStops(args.dRange);
  const sceneRef = !DISPLAY_REFERRED_PROFILES.has(args.profile);
  const dr = !sceneRef && args.dRange !== 100 ? DR_SHOULDER[args.dRange] : null;
  const es = P && PROCESSED_PROFILES.has(args.profile) ? P.es * st * Math.min(1, Math.max(0, args.renderScale)) : 0;
  return {
    uIspHd: P ? P.hd * st : 0,
    uIspMh: P ? P.mh * st : 0,
    uIspMhTint: P ? P.mhTint : [1, 1, 1],
    uIspSd: P ? P.sd * st : 0,
    uIspPop: P ? P.pop * st : 0,
    uIspEs: es,
    uDrStops: k,
    uSceneRef: sceneRef,
    uRollW: 2.04 * Math.pow(2, k),
    uDrY0: dr ? dr.y0 : 0,
    uDrS: dr ? dr.s : 0,
  };
}

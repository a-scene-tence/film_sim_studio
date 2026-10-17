// WB 스포이트(최종 출력 기준 역산 · 확대된 권한) · 그레인 강화(1080 프레임 정규화, 강도 계수, 바닥값)
import { describe, expect, it } from "vitest";
import { FS_FINAL_GLSL } from "../src/lib/render/glsl/fs_final";
import { FILM_PRESETS } from "../src/lib/render/film-presets";
import { grainCoarse, grainScaleFull, grainScalePreview } from "../src/lib/render/plan";
import { GRAIN_FLOOR, GRAIN_GAIN } from "../src/lib/render/grain";
import { grainApply, pixelPipelineFromWs, type PixelCtx } from "../src/lib/render/reference";
import { apply3, wbMatrix } from "../src/lib/render/wb";
import { solveEyedropperOutput, solveNeutralOutput, type RgbaGrid } from "../src/lib/studio/color-auto";

const inv = (m: number[][]) => {
  const [[a, b, c], [d, e, f], [g, h, i]] = m as [[number, number, number], [number, number, number], [number, number, number]];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]] as [[number, number, number], [number, number, number], [number, number, number]];
};
const enc = (x: number) => (x <= 0.0031308 ? 12.92 * Math.max(x, 0) : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
const spread = (o: ArrayLike<number>) => Math.max(Math.abs(o[0]! - o[1]!), Math.abs(o[2]! - o[1]!));

describe("WB 권한 확대", () => {
  it("(0,0) 은 여전히 단위행렬", () => {
    const m = wbMatrix(0, 0);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) expect(Math.abs(m[r]![c]! - (r === c ? 1 : 0))).toBeLessThan(1e-6);
  });
  it("temp −100 은 텅스텐급(약 2800K) 캐스트를 덮는다: 파랑 이득이 구 계수(0.9)보다 확연히 크다", () => {
    expect(wbMatrix(-100, 0)[2][2]).toBeGreaterThan(2.2);
    expect(wbMatrix(100, 0)[2][2]).toBeLessThan(0.7);
  });
});

describe("스포이트: 필름 적용 후 출력 기준 중성 역산", () => {
  // 합성 필름: 채널별 이득(따뜻한 틴트)·감마 → 표시 RGB. 중성 입력도 이 필름을 통과하면 색조가 생긴다.
  const film = [1.12, 1.0, 0.82];
  const makeEval = (sample: [number, number, number]) => (t: number, k: number) => {
    const x = apply3(wbMatrix(t, k), sample);
    return x.map((q, i) => enc(Math.min(1, Math.max(0, q * film[i]!))));
  };
  it("필름이 중성을 틴트해도 최종 R=G=B 로 수렴한다 (Pre-LUT 중성으로 맞추면 실패하는 케이스)", () => {
    const cast = inv(wbMatrix(-60, 15));
    const sample = apply3(cast, [0.4, 0.4, 0.4]) as [number, number, number];
    const naive = makeEval(sample)(0, 0);
    expect(spread(naive)).toBeGreaterThan(0.05);
    const r = solveNeutralOutput(makeEval(sample));
    expect(spread(r.out)).toBeLessThan(0.01);
    expect(spread(makeEval(sample)(r.temp, r.tint))).toBeLessThan(0.01);
    // 필름이 더하는 따뜻한 틴트를 상쇄하려면 Pre-LUT 중성(−60, 15 부근)에서 벗어나야 한다
    expect(r.temp !== -60 || r.tint !== 15).toBe(true);
  });
  it("강한 텅스텐/푸른 그늘 캐스트도 ±100 안에서 제거한다", () => {
    for (const [t, k] of [[-95, 0], [90, 0], [-80, 40], [60, -50]] as const) {
      const sample = apply3(inv(wbMatrix(t, k)), [0.35, 0.35, 0.35]) as [number, number, number];
      const r = solveNeutralOutput((tt, kk) => apply3(wbMatrix(tt, kk), sample).map((q) => enc(q)));
      expect(spread(r.out), `${t},${k}`).toBeLessThan(0.01);
    }
  });
  it("실제 픽셀 경로(pixelPipelineFromWs, 필름 LUT 없음+비네팅)로도 수렴하고 격자 Y축은 표시 방향(위→아래)이다", () => {
    const ctx: PixelCtx = {
      norm: { profile: 0, limitedCV: false, srcToWS: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], rawScale: 1, srcLut: null, samsungFix: false, rgc: false, rolloff: false, wb: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], expGain: 1 },
      ct: 20, vig: -10, aspect: 1.5, lut: { mode: 0 }, mono: false, ke: 0, kb: 0, curve: null, sat: 0, vib: 0, grain: null,
    };
    const warm = apply3(inv(wbMatrix(-40, 10)), [0.5, 0.5, 0.5]) as [number, number, number];
    // 위쪽 절반은 회색 캐스트, 아래쪽 절반은 전혀 다른 청색: (u, v=0.125) 는 위쪽을 가리켜야 한다
    const W = 8, H = 8, data = new Float32Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set(y < H / 2 ? [...warm, 1] : [0.1, 0.2, 0.9, 1], (y * W + x) * 4);
    const g: RgbaGrid = { width: W, height: H, data };
    const u = 0.5, v = 0.125;
    const r = solveEyedropperOutput(g, u, v, (sample) => (t, k) => pixelPipelineFromWs(apply3(wbMatrix(t, k), sample), u, v, 4.5, 2.5, ctx))!;
    expect(r.sample[0]).toBeCloseTo(warm[0], 5);
    expect(spread(r.out)).toBeLessThan(0.01);
  });
  it("너무 어두운 표본은 null", () => {
    const g: RgbaGrid = { width: 4, height: 4, data: new Float32Array(64) };
    expect(solveEyedropperOutput(g, 0.5, 0.5, (s) => () => s)).toBeNull();
  });
});

describe("그레인 강화", () => {
  it("크기 소/대: 입자 격자는 키우지 않고 3×3 클러스터 중첩 비율만 0 → 1", () => {
    expect(grainCoarse(0)).toBe(0);
    expect(grainCoarse(100)).toBe(1);
  });
  it("해상도 독립: 짧은 변 1080 기준 정규화, 1080 이하에서는 1px 셀", () => {
    expect(grainScaleFull(1080)).toBeCloseTo(1, 9);
    expect(grainScaleFull(720)).toBe(1);
    expect(grainScaleFull(2160) / 2160).toBeCloseTo(grainScaleFull(1080) / 1080 * 1, 9);
    expect(grainScaleFull(4320)).toBeCloseTo(4, 9);
    // 미리보기는 렌더 배율만큼 줄어든다 (저장본과 같은 프레임 비율, 최소 1px 셀)
    expect(grainScalePreview(4320, 1080)).toBeCloseTo(1, 9);
    expect(grainScalePreview(4320, 2160)).toBeCloseTo(2, 9);
  });
  it("강도 계수·중간톤 응답: 중간톤 최대, 하이라이트·암부는 바닥값 이상", () => {
    expect(GRAIN_GAIN).toBeLessThan(0.1);
    const mid = grainApply([0.5, 0.5, 0.5], 100, 1)[0]! - 0.5;
    const dark = grainApply([0.02, 0.02, 0.02], 100, 1)[0]! - 0.02;
    const bright = 0.95 - grainApply([0.95, 0.95, 0.95], 100, -1)[0]!;
    expect(mid).toBeCloseTo(GRAIN_GAIN, 9);
    expect(dark).toBeGreaterThan(GRAIN_GAIN * GRAIN_FLOOR);
    expect(dark).toBeLessThan(mid);
    expect(bright).toBeGreaterThan(GRAIN_GAIN * GRAIN_FLOOR);
    expect(bright).toBeLessThan(mid);
  });
  it("GLSL 이 CPU 참조와 같은 상수를 쓴다", () => {
    expect(FS_FINAL_GLSL).toContain(`${GRAIN_GAIN} * (uGrainAmt / 100.0)`);
    expect(FS_FINAL_GLSL).toContain(`float resp = ${GRAIN_FLOOR} + (1.0 - ${GRAIN_FLOOR}) * max(4.0 * vl * (1.0 - vl), 0.0);`);
    expect(FS_FINAL_GLSL).toContain("uniform float uGrainCoarse");
  });
  it("필름 프리셋 기본 그레인이 체감되는 수준", () => {
    for (const id of ["fuji-classic-chrome", "fuji-classic-neg", "fuji-nostalgic-neg", "ricoh-positive-film", "ricoh-negative-film", "fuji-acros"]) {
      const a = FILM_PRESETS[id]!.grainAmount;
      expect(a, id).toBeGreaterThanOrEqual(25);
      expect(a, id).toBeLessThanOrEqual(45);
    }
    for (const id of ["ricoh-hi-contrast-bw", "fuji-eterna-bleach-bypass", "ricoh-bleach-bypass"]) {
      const a = FILM_PRESETS[id]!.grainAmount;
      expect(a, id).toBeGreaterThanOrEqual(55);
      expect(a, id).toBeLessThanOrEqual(70);
    }
  });
});

import { describe, expect, it } from "vitest";
import { bakeCurve, sampleCurve, type CurvePreset, type CurveState } from "../src/lib/render/curve";
import * as R from "../src/lib/render/reference";

const close = (a: ArrayLike<number>, b: ArrayLike<number>, tol = 1e-5) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < b.length; i++) expect(Math.abs(a[i]! - b[i]!), `[${i}] ${a[i]} vs ${b[i]}`).toBeLessThan(tol);
};
const tone0 = { sh: 0, hi: 0, wh: 0, bk: 0, br: 0, lb: 0 };

describe("섹션 15.2-3 CPU 참조", () => {
  it("rgc", () => {
    close(R.rgc([0.5, 0.2, -0.1]), [0.5, 0.2, 0.004294]);
    close(R.rgc([0.8, -0.05, 0.3]), [0.8, 0.03547, 0.3]);
    close(R.rgc([0.2, 0.3, 0.25]), [0.2, 0.3, 0.25]);
  });
  it("rolloff", () => {
    close(R.rolloff([0.5, 0.5, 0.5]), [0.5, 0.5, 0.5]);
    close(R.rolloff([2, 2, 2]), [1.774761, 1.774761, 1.774761]);
    close(R.rolloff([6, 3, 1]), [3.474445, 1.737222, 0.579074]);
  });
  it("samsungFix", () => {
    close(R.samsungFix([0.4, 0.22, 0.16]), [0.390757, 0.223811, 0.158209]);
    close(R.samsungFix([0.18, 0.18, 0.18]), [0.18, 0.18, 0.18]);
    close(R.samsungFix([0.1, 0.2, 0.5]), [0.1, 0.2, 0.5]);
  });
  it("dehaze", () => {
    const x = [0.3, 0.32, 0.35], A = [0.8, 0.82, 0.85];
    close(R.dehazeApply(x, 50, A, 0.6), [0.175, 0.195, 0.225]);
    close(R.dehazeApply(x, -50, A, 0.6), [0.4, 0.42, 0.45]);
  });
  it("baseTone (Bs = log2(luma), 디테일 0)", () => {
    const ab: [number, number] = [1, 0];
    close(R.baseTone([0.05, 0.04, 0.03], ab, { ...tone0, sh: 1 }), [0.119992, 0.095993, 0.071995]);
    close(R.baseTone([0.05, 0.04, 0.03], ab, { ...tone0, lb: 1 }), [0.10072, 0.080576, 0.060432]);
    close(R.baseTone([1.2, 1.1, 1.0], ab, { ...tone0, hi: -1 }), [0.424264, 0.388909, 0.353553]);
    close(R.baseTone([1.2, 1.1, 1.0], ab, { ...tone0, lb: 1 }), [0.52271, 0.479151, 0.435592]);
  });
  it("contrast", () => {
    close(R.contrastOp([0.36, 0.3, 0.25], 0.5), [0.412122, 0.343435, 0.286195]);
    close(R.contrastOp([0.36, 0.3, 0.25], -0.5), [0.31447, 0.262059, 0.218382]);
  });
  it("vignette (종횡비 1.5)", () => {
    close([R.vignetteF(0, 0, 1.5, -100)], [0.25]);
    close([R.vignetteF(0, 0, 1.5, 100)], [4.0]);
    close([R.vignetteF(0.25, 0.5, 1.5, -50)], [0.918771]);
    close([R.vignetteF(0.5, 0.5, 1.5, -70)], [1]);
  });
  it("clipNeg", () => close(R.clipNeg([0.4, -0.05, 0.2]), [0.252146, 0, 0.140081]));
  it("원본 모드 srgbEnc(toneRef(x))", () => close(R.originalEnc([0.18, 1.0, 0.01]), [0.473121, 0.879849, 0.065758]));
  it("CCE / FX 블루", () => {
    close(R.cceOp([0.85, 0.25, 0.2], 0.2, 0), [0.782316, 0.178054, 0.138219]);
    close(R.cceOp([0.2, 0.35, 0.8], 0, 0.24), [0.135154, 0.267748, 0.712104]);
    close(R.cceOp([0.5, 0.5, 0.5], 0.2, 0.24), [0.5, 0.5, 0.5]);
  });
  it("톤 커브 256칸 + 선형 보간", () => {
    const xs = [0.1, 0.3, 0.6, 0.9];
    const s = (preset: CurvePreset): CurveState => ({ preset, points: null, zones: [0, 0, 0, 0, 0] });
    const at = (st: CurveState, v: number[]) => { const T = bakeCurve(st); return v.map((x) => sampleCurve(T, x)); };
    close(at(s("linear"), xs), xs);
    close(at(s("weak-contrast"), xs), [0.08512, 0.272163, 0.61488, 0.91488]);
    close(at(s("strong-contrast"), xs), [0.065281, 0.234886, 0.63896, 0.939679]);
    close(at(s("matte"), xs), [0.15808, 0.325442, 0.61792, 0.88192]);
    close(at(s("soft-highlight"), xs), [0.09904, 0.303613, 0.611983, 0.860634]);
    close(at({ preset: "linear", points: null, zones: [0, 50, 0, -50, 0] }, [0.3, 0.5, 0.7]), [0.349988, 0.5, 0.650012]);
  });
  it("채도·생동감", () => {
    close(R.postChroma([0.7, 0.5, 0.4], 0, 50, 0, null), [0.72468, 0.488226, 0.368627]);
    close(R.postChroma([0.3, 0.6, 0.4], 0, 50, 0, null), [0.21854, 0.61392, 0.369356]);
    close(R.postChroma([0.3, 0.6, 0.4], -100, 0, 0, null), [0.525486, 0.525486, 0.525486]);
    close(R.postChroma([0.3, 0.6, 0.4], 30, -40, 0, null), [0.322352, 0.595178, 0.40991]);
  });
  it("명료도·선명도", () => {
    close([R.clarityL(0.6, 0.5, 50)], [0.6576]);
    close([R.sharpenL(0.6, 0.55, 100)], [0.6552]);
    close([R.sharpenL(0.6, 0.598, 100)], [0.6]);
  });
  it("valueNoise", () => {
    close([R.valueNoise(0.5, 0.25, 0)], [0.219603]);
  });
  it("그레인 n", () => {
    close([R.grainNoise(100.5, 200.5, 2, [0, 0])], [-0.104379]);
    close([R.grainNoise(10.5, 20.5, 1, [123.4, 567.8])], [0.058362]);
    close([R.grainNoise(10.5, 20.5, 1, [123.4, 567.8], 1)], [0.03573]);
  });
  it("그레인 적용", () => {
    close(R.grainApply([0.5, 0.5, 0.5], 50, 0.8), [0.582, 0.582, 0.582]);
    close(R.grainApply([0.02, 0.02, 0.02], 50, 0.8), [0.066576, 0.066576, 0.066576]);
  });
  it("pcg3d", () => {
    expect(R.pcg3d(10, 20, 0)).toEqual([3376042976, 46032776, 3116085429]);
    expect(R.pcg3d(10, 20, 1)).toEqual([2352768864, 1144463395, 3877898674]);
    expect(R.pcg3d(0, 0, 0)).toEqual([2611992518, 2833812075, 1058359340]);
  });
});

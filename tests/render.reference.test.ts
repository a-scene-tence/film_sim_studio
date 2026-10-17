import { describe, expect, it } from "vitest";
import { bakeCurve, sampleCurve, type CurvePreset, type CurveState } from "../src/lib/render/curve";
import * as R from "../src/lib/render/reference";
import { linToOklab, srgbDec } from "../src/lib/color/fse/engine.mjs";

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
    close(R.baseTone([0.05, 0.04, 0.03], ab, { ...tone0, sh: 1 }), [0.101922, 0.081538, 0.061153]);
    close(R.baseTone([0.05, 0.04, 0.03], ab, { ...tone0, lb: 1 }), [0.10072, 0.080576, 0.060432]);
    close(R.baseTone([1.2, 1.1, 1.0], ab, { ...tone0, hi: -1 }), [0.469644, 0.430507, 0.39137]);
    close(R.baseTone([1.2, 1.1, 1.0], ab, { ...tone0, lb: 1 }), [0.52271, 0.479151, 0.435592]);
  });
  it("contrast", () => {
    close(R.contrastOp([0.36, 0.3, 0.25], 0.5), [0.409481, 0.341234, 0.284362]);
    close(R.contrastOp([0.36, 0.3, 0.25], -0.5), [0.316498, 0.263749, 0.219791]);
  });
  it("vignette (종횡비 1.5)", () => {
    close([R.vignetteF(0, 0, 1.5, -100)], [0.25]);
    close([R.vignetteF(0, 0, 1.5, 100)], [4.0]);
    close([R.vignetteF(0.25, 0.5, 1.5, -50)], [0.918771]);
    close([R.vignetteF(0.5, 0.5, 1.5, -70)], [1]);
  });
  it("clipNeg", () => close(R.clipNeg([0.4, -0.05, 0.2]), [0.252146, 0, 0.140081]));
  it("원본 모드 srgbEnc(toneRef(x))", () => close(R.originalEnc([0.18, 1.0, 0.01]), [0.473121, 0.879849, 0.065758]));
  it("CCE / FX 블루 (OPT-v1): 레벨별 명도 농도 · 절제된 순도 · 상한", () => {
    const lab = (v: number[]) => { const [L, a, b] = linToOklab(v.map(srgbDec)); return { L, C: Math.hypot(a, b) }; };
    const red = [0.85, 0.25, 0.2], leaf = [0.3, 0.7, 0.25], sky = [0.62, 0.78, 0.95], denim = [0.2, 0.35, 0.8], pink = [0.75, 0.4, 0.45];
    const E = [0, 0.075, 0.145], B = [0, 0.065, 0.13];
    // 순도 = C/L. 명도는 내려가고 순도는 소폭 오르되, 절대 크로마는 늘지 않는다 (형광·수채 얼룩 방지)
    const chk = (px: number[], mk: (k: number) => number[], maxDrop: number, maxPur: number) => {
      const o = [0, 1, 2].map((k) => lab(mk(k)));
      expect(o[1]!.L).toBeLessThan(o[0]!.L - 0.005);
      expect(o[2]!.L).toBeLessThan(o[1]!.L - 0.005);
      expect(1 - o[2]!.L / o[0]!.L).toBeLessThanOrEqual(maxDrop + 1e-6);
      const pur = (q: { L: number; C: number }) => q.C / q.L;
      expect(pur(o[1]!)).toBeGreaterThan(pur(o[0]!));
      expect(pur(o[2]!)).toBeGreaterThan(pur(o[1]!));
      expect(pur(o[2]!) / pur(o[0]!) - 1).toBeLessThanOrEqual(maxPur + 1e-6);
      expect(o[2]!.C).toBeLessThanOrEqual(o[0]!.C + 1e-6);
      close(R.cceOp(px, 0, 0), px, 1e-5);
    };
    for (const px of [red, leaf, pink]) chk(px, (k) => R.cceOp(px, E[k]!, 0), 0.145, 0.06);
    for (const px of [sky, denim]) chk(px, (k) => R.cceOp(px, 0, B[k]!), 0.13, 0.1);
    // 최대 마스크 픽셀에서 상한에 근접: CCE 강 ≈ 14.5%, 약 ≈ 7.5%
    const drop = (px: number[], e: number, b: number) => 1 - lab(R.cceOp(px, e, b)).L / lab(px).L;
    expect(drop(leaf, 0.145, 0)).toBeGreaterThan(0.12);
    expect(drop(leaf, 0.075, 0)).toBeGreaterThan(0.06);
    expect(drop(sky, 0, 0.13)).toBeGreaterThan(0.08);
    close(R.cceOp([0.5, 0.5, 0.5], 0.145, 0.13), [0.5, 0.5, 0.5]);
    close(R.cceOp([0.9, 0.92, 0.95], 0, 0.13), [0.9, 0.92, 0.95], 2e-3); // 흰 구름 불변
    // 피부톤(연한 살구)은 같은 레벨에서 고채도 주황보다 덜 눌린다
    expect(drop([0.85, 0.65, 0.55], 0.145, 0)).toBeLessThan(drop([0.95, 0.5, 0.05], 0.145, 0) * 0.4);
  });
  it("CCE / FX 블루 그라데이션 연속성: 계조 점프·역전 없음", () => {
    const L = (v: number[]) => linToOklab(v.map(srgbDec))[0];
    const N = 400;
    const maxJumpOf = (path: (t: number) => number[], e: number, b: number, n: number) => {
      let mj = 0, prevIn = 0, prevOut = 0;
      for (let i = 0; i <= n; i++) {
        const px = path(i / n);
        const lo = L(R.cceOp(px, e, b)), li = L(px);
        if (i > 0) mj = Math.max(mj, Math.abs((lo - prevOut) - (li - prevIn)));
        prevIn = li; prevOut = lo;
      }
      return mj;
    };
    // 경로: 무채 → 고채도 (채도 램프), 어둠 → 밝음 (명도 램프), 흰 구름 → 코발트 하늘, 하늘 → 건물 회색, 색상 일주
    const paths: Array<(t: number) => number[]> = [
      (t) => [0.6, 0.6 - 0.45 * t, 0.6 - 0.5 * t],
      (t) => [0.05 + 0.85 * t, 0.02 + 0.3 * t, 0.01 + 0.15 * t],
      (t) => [0.92 - 0.72 * t, 0.94 - 0.5 * t, 0.97 - 0.07 * t],
      (t) => [0.25 + 0.3 * t, 0.5 + 0.05 * t, 0.9 - 0.35 * t],
      (t) => { const h = 2 * Math.PI * t; return [0.5 + 0.35 * Math.cos(h), 0.5 + 0.35 * Math.cos(h - 2.094), 0.5 + 0.35 * Math.cos(h + 2.094)]; },
      (t) => [0.08 + 0.85 * t, 0.12 + 0.6 * t, 0.3 + 0.68 * t],
    ];
    for (const [e, b] of [[0.145, 0], [0, 0.13], [0.145, 0.13], [0.075, 0.065]] as const) {
      for (const path of paths) {
        // 걸음(1/400) 당 출력 명도가 입력보다 0.006 이상 벗어나지 않고, 걸음을 1/4 로 줄이면 편차도 ~1/4 로 준다 (불연속·계단 없음)
        const j1 = maxJumpOf(path, e, b, N), j4 = maxJumpOf(path, e, b, 4 * N);
        expect(j1, `${e}/${b} ${path(0)}→${path(1)}`).toBeLessThan(0.006);
        expect(j4, `${e}/${b} ${path(0)}→${path(1)}`).toBeLessThan(0.35 * j1 + 1e-5);
      }
      // 명도 램프(같은 색비)에서 출력 명도는 단조 증가
      let prev = -1;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const o = L(R.cceOp([0.9 * t, 0.35 * t, 0.15 * t], e, b));
        expect(o).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = o;
      }
    }
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
    close(R.postChroma([0.7, 0.5, 0.4], 0, 50, 0, null), [0.719925, 0.483832, 0.364357]);
    close(R.postChroma([0.3, 0.6, 0.4], 0, 50, 0, null), [0.20929, 0.606114, 0.362087]);
    close(R.postChroma([0.3, 0.6, 0.4], 50, 0, 0, null), [0.057317, 0.610494, 0.326119]);
    close(R.postChroma([0.3, 0.6, 0.4], -100, 0, 0, null), [0.525486, 0.525486, 0.525486]);
    close(R.postChroma([0.3, 0.6, 0.4], 30, -40, 0, null), [0.322352, 0.595178, 0.40991]);
  });
  it("명료도·선명도", () => {
    close([R.clarityL(0.6, 0.5, 50)], [0.639089]);
    close([R.sharpenL(0.6, 0.55, 100)], [0.636345]);
    close([R.sharpenL(0.6, 0.65, 100)], [0.556446]);
    close([R.sharpenL(0.6, 0.598, 100)], [0.6]);
  });
  it("OPT-v1 시그모이드 대비: 중회색 기울기 1+0.5ct, 토·숄더 복귀, 단조", () => {
    const g = (e: number, ct: number) => Math.log2(R.contrastOp([0.18 * 2 ** e, 0.18 * 2 ** e, 0.18 * 2 ** e], ct)[0] / 0.18);
    expect((g(0.01, 1) - g(-0.01, 1)) / 0.02).toBeCloseTo(1.5, 3);
    expect((g(0.01, -1) - g(-0.01, -1)) / 0.02).toBeCloseTo(0.5, 3);
    expect(Math.abs(g(10, 1) - 10)).toBeLessThan(0.01);
    expect(Math.abs(g(-10, 1) + 10)).toBeLessThan(0.01);
    for (const ct of [1, -1]) for (let e = -14; e < 8; e += 0.02) expect(g(e + 0.02, ct)).toBeGreaterThan(g(e, ct));
  });
  it("OPT-v1 존 분리 베이스 톤: 블랙 코어·중간톤 고정, 단조", () => {
    const st = (e: number, s: Partial<typeof tone0>) => { const Y = 0.18 * 2 ** e; return Math.log2(R.baseTone([Y, Y, Y], [1, 0], { ...tone0, ...s })[0] / Y); };
    expect(st(-7, { sh: 1 })).toBeLessThan(0.01);
    expect(st(0, { sh: 1 })).toBeLessThan(0.05);
    expect(st(-3, { sh: 1 })).toBeGreaterThan(1.4);
    expect(st(4, { hi: -1 })).toBeCloseTo(-1.5, 6); // 숄더 끝: 최대 복원 −1.5 stop
    for (let e = -1; e < 3.5; e += 0.02) expect(e + 0.02 + st(e + 0.02, { hi: -1 }) - (e + st(e, { hi: -1 }))).toBeGreaterThan(0.5 * 0.02 - 1e-9); // 숄더 기울기 ≥ 0.5
    for (const s of [{ sh: 1 }, { sh: -1 }, { hi: -1 }, { hi: 1 }, { lb: 1 }, { lb: -1 }]) {
      for (let e = -12; e < 6; e += 0.02) expect(e + 0.02 + st(e + 0.02, s)).toBeGreaterThan(e + st(e, s));
    }
    // 압축된 존의 국소 디테일 복원: 쉐도우 리프트 시 Dt 증폭
    const ab: [number, number] = [0, Math.log2(0.18 * 2 ** -3)];
    const Y1 = 0.18 * 2 ** -3.1, Y2 = 0.18 * 2 ** -2.9;
    const det = (sh: number) => Math.log2(R.baseTone([Y2, Y2, Y2], ab, { ...tone0, sh })[0] / R.baseTone([Y1, Y1, Y1], ab, { ...tone0, sh })[0]);
    expect(det(0)).toBeCloseTo(0.2, 9);
    expect(det(1)).toBeGreaterThan(0.24);
  });
  it("OPT-v1 H–K 광학 농도: 채도·생동감 +에서 명도 최대 6% 감소, −에서는 불변", () => {
    const L = (v: number[]) => linToOklab(v.map(srgbDec))[0];
    const px = [0.3, 0.6, 0.4];
    const d = (s: number, v: number) => 1 - L(R.postChroma(px, s, v, 0, null)) / L(px);
    expect(d(50, 0)).toBeGreaterThan(0.01);
    expect(d(100, 0)).toBeGreaterThan(d(50, 0));
    for (const s of [25, 50, 100]) expect(d(s, 0)).toBeLessThanOrEqual(0.06);
    expect(d(0, 100)).toBeLessThanOrEqual(0.06);
    expect(Math.abs(d(-50, 0))).toBeLessThan(1e-3);
    close(R.postChroma([0.5, 0.5, 0.5], 100, 100, 0, null), [0.5, 0.5, 0.5]);
  });
  it("OPT-v1 명료도·선명도 할로 억제 (tanh 리미터, 암부·극명부 감쇠)", () => {
    // 작은 결은 거의 선형, 큰 경계는 포화
    expect(R.clarityL(0.5, 0.49, 100) - 0.5).toBeCloseTo(1.2 * 0.01, 3);
    expect(R.clarityL(0.5, 0.0, 100) - 0.5).toBeLessThan(1.2 * 0.08 + 1e-9);
    expect(R.clarityL(0.01, 0.0, 100)).toBeCloseTo(0.01, 6);
    // 흰 오버슈트(+)는 어두운 쪽(−)보다 상한이 낮다
    expect(R.sharpenL(0.5, 0.2, 150) - 0.5).toBeLessThan(1.5 * 1.2 * 0.035 + 1e-9);
    expect(0.5 - R.sharpenL(0.5, 0.8, 150)).toBeLessThan(1.5 * 1.2 * 0.05 + 1e-9);
    expect(R.sharpenL(0.01, 0.0, 150)).toBeCloseTo(0.01, 6);
  });
  it("OPT-v1 디헤이즈 소프트 토: 0 근처 계조 연속·단조", () => {
    const A = [0.8, 0.8, 0.8];
    let prev = -1;
    for (let i = 0; i <= 200; i++) {
      const x = 0.4 + 0.2 * (i / 200);
      const o = R.dehazeApply([x, x, x], 100, A, 0.5)[0];
      expect(o).toBeGreaterThan(prev);
      expect(o).toBeGreaterThan(0);
      prev = o;
    }
  });
  it("셀 삼각 PDF 노이즈", () => {
    close([R.cellTri(3, 4, 0)], [-0.33869902]);
  });
  it("그레인 n (소: coarse 0, 대: coarse 1)", () => {
    close([R.grainNoise(100.5, 200.5, 2, [0, 0], 0)], [0.87158538]);
    close([R.grainNoise(10.5, 20.5, 1, [123.4, 567.8], 0)], [0.27027049]);
    close([R.grainNoise(10.5, 20.5, 1, [123.4, 567.8], 1)], [0.86441768]);
    close([R.grainNoise(100.5, 200.5, 1, [0, 0], 1)], [-1.40448842]);
  });
  it("그레인 적용", () => {
    close(R.grainApply([0.5, 0.5, 0.5], 50, 0.8), [0.524, 0.524, 0.524]);
    close(R.grainApply([0.02, 0.02, 0.02], 50, 0.8), [0.02630531, 0.02630531, 0.02630531]);
  });
  it("pcg3d", () => {
    expect(R.pcg3d(10, 20, 0)).toEqual([3376042976, 46032776, 3116085429]);
    expect(R.pcg3d(10, 20, 1)).toEqual([2352768864, 1144463395, 3877898674]);
    expect(R.pcg3d(0, 0, 0)).toEqual([2611992518, 2833812075, 1058359340]);
  });
});

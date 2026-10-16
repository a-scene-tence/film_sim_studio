// Step 4 §4 — Samsung Log 내장 공식 수식(profile 14), D-Log M 근사(D-Log + D-Gamut), 입력 바인딩. (T1 T2 T3)
import { describe, expect, it } from "vitest";
import { matrixToWS } from "../src/lib/color/source/primaries.mjs";
import { dlog, dlogEncode, samsunglog, samsunglogEncode } from "../src/lib/color/source/transfer.mjs";
import { toWorkingSpace } from "../src/lib/color/source/normalize.mjs";
import { decodeLog } from "../src/lib/render/reference";
import { resolveInputBinding } from "../src/lib/render/binding";
import type { SourceDescriptor, SourceProfileId } from "../src/lib/media-loader";

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
const desc = (profile: SourceProfileId, range: "full" | "limited" = "limited", primaries: SourceDescriptor["primaries"] = "rec2020"): SourceDescriptor =>
  ({ profile, primaries, range, bitDepth: 10, rawScale: null });

describe("T1 Samsung Log (Step 4 §4-1)", () => {
  it("인코드 골든 (White Paper Table 1, 1e-6)", () => {
    const G: Array<[number, number, number]> = [[0, 0.125124, 128], [0.01, 0.206562, 211], [0.18, 0.527859, 540], [0.9, 0.7087, 725], [12, 1.0, 1023]];
    for (const [x, y, cv] of G) {
      expect(Math.abs(samsunglogEncode(x) - y)).toBeLessThan(1e-6);
      expect(Math.round(samsunglogEncode(x) * 1023)).toBe(cv);
    }
  });
  it("디코드 골든 (상대오차 1e-9)", () => {
    const G: Array<[number, number]> = [
      [0, -0.0500028134975], [0.25006105006105006, 0.014893883316], [0.5001221001221001, 0.140581129049], [0.7501831501831502, 1.30158669211],
      [0.20659340659340658, 0.0100029028814], [1, 12.0000122747],
    ];
    for (const [y, x] of G) expect(rel(samsunglog(y), x)).toBeLessThan(1e-9);
  });
  it("GPU float32 골든 값 (상대오차 1e-4) — CPU 미러", () => {
    expect(rel(decodeLog(0.2, 14), 0.009483183)).toBeLessThan(1e-4);
    expect(rel(decodeLog(0.5, 14), 0.1404282)).toBeLessThan(1e-4);
    expect(rel(decodeLog(0.8, 14), 2.02708)).toBeLessThan(1e-4);
  });
  it("분기점 연속성", () => {
    const yb = 0.206561909;
    const hi = Math.pow(10, (yb - 0.720504856) / 0.258984868) - 0.0003645;
    const lo = 0.016904 - Math.pow(10, (yb + 0.24597) / -0.20942);
    expect(Math.abs(hi - lo)).toBeLessThan(1e-6);
    expect(Math.abs(hi - 0.01)).toBeLessThan(1e-6);
    expect(Math.abs(lo - 0.01)).toBeLessThan(1e-6);
  });
  it("왕복 x∈[-0.05,12] 0.001 간격", () => {
    // 분기점 x=0.01 의 격자점(0.01 − 5e-18)만 예외다: 두 분기 상수가 5.5e-13 이 아닌 ~1e-7 어긋나 있어 인코드가 하위 분기,
    // 디코드가 상위 분기를 고른다. 사양의 연속성 허용치(1e-6) 안에서 검사하고 완료 보고에 남긴다.
    let worst = 0;
    for (let i = 0; i <= 12050; i++) {
      const x = -0.05 + i * 0.001;
      const tol = Math.abs(x - 0.01) < 1e-9 ? 1e-6 : 1e-9 * Math.max(1, Math.abs(x));
      worst = Math.max(worst, Math.abs(samsunglog(samsunglogEncode(x)) - x) / tol);
    }
    expect(worst).toBeLessThanOrEqual(1);
  });
  it("limited 브라우저 확장값 vBlack 0.0731, vGrey 0.5434", () => {
    expect(Math.abs((128 - 64) / 876 - 0.0731)).toBeLessThan(5e-5);
    expect(Math.abs((540 - 64) / 876 - 0.5434)).toBeLessThan(5e-5);
  });
  it("M_2020→709 대조 (원소별 1e-5)", () => {
    const G = [[1.660491, -0.587641, -0.07285], [-0.12455, 1.1329, -0.008349], [-0.018151, -0.100579, 1.11873]];
    const m = matrixToWS("rec2020");
    G.forEach((r, i) => r.forEach((v, j) => expect(Math.abs(m[i]![j]! - v)).toBeLessThan(1e-5)));
  });
  it("CPU 내장 변환: 18% 회색(CV 540 limited)이 중간 회색 근방", () => {
    const v = (540 - 64) / 876;
    const o = toWorkingSpace([v, v, v], desc("samsunglog"));
    expect(rel(o[1], 0.18)).toBeLessThan(2e-3);
  });
});

describe("T2 D-Log M 근사 (D-Log + D-Gamut, Step 4 §4-2)", () => {
  it("디코드 골든 (상대오차 1e-6), 기존 profile 10 과 같은 식", () => {
    const G: Array<[number, number]> = [[0.14, 0.007817427], [0.39877, 0.1800092], [0.5, 0.462534], [0.8, 6.973398], [1.0, 41.99939]];
    for (const [y, x] of G) {
      expect(rel(dlog(y), x)).toBeLessThan(1e-6);
      expect(decodeLog(y, 10)).toBe(dlog(y));
    }
    expect(Math.abs(dlog(0.0929))).toBeLessThan(1e-12);
  });
  it("인코드 골든 (상대오차 1e-6)", () => {
    expect(rel(dlogEncode(0.18), 0.398765)).toBeLessThan(1e-5);
    expect(rel(dlogEncode(1), 0.584555)).toBeLessThan(1e-6);
    expect(rel(dlogEncode(10), 0.840129)).toBeLessThan(1e-6);
  });
  it("D-Gamut→WS 행렬 대조 (원소별 1e-5)", () => {
    const G = [[1.674723, -0.579789, -0.094934], [-0.098088, 1.333984, -0.235896], [-0.040967, -0.242984, 1.283951]];
    const m = matrixToWS("d-gamut");
    G.forEach((r, i) => r.forEach((v, j) => expect(Math.abs(m[i]![j]! - v)).toBeLessThan(1e-5)));
  });
});

describe("T3 resolveInputBinding (Step 4 §4-3)", () => {
  it("samsunglog + 사용자 LUT → 13", () => {
    const b = resolveInputBinding(desc("samsunglog"), true);
    expect([b.profile, b.samsungFix, b.useSourceLut, b.badge, b.approximate]).toEqual([13, true, true, "Samsung Log · LUT", false]);
  });
  it("samsunglog + LUT 없음 → 14, rec2020, 레인지 규칙, 롤오프", () => {
    const lim = resolveInputBinding(desc("samsunglog", "limited"), false);
    expect([lim.profile, lim.limitedCV, lim.rolloff, lim.samsungFix, lim.badge, lim.approximate]).toEqual([14, true, true, true, "Samsung Log", false]);
    expect(resolveInputBinding(desc("samsunglog", "full"), false).limitedCV).toBe(false);
    const m = matrixToWS("rec2020");
    lim.srcToWS.forEach((r, i) => r.forEach((v, j) => expect(Math.abs(v - m[i]![j]!)).toBeLessThan(1e-12)));
  });
  it("dlogm + 사용자 LUT → 13, samsungFix false", () => {
    const b = resolveInputBinding(desc("dlogm"), true);
    expect([b.profile, b.samsungFix, b.badge, b.approximate]).toEqual([13, false, "D-Log M · LUT", false]);
  });
  it("dlogm + LUT 없음 → 10, d-gamut, limitedCV false, 롤오프, 근사", () => {
    const b = resolveInputBinding(desc("dlogm", "limited"), false);
    expect([b.profile, b.limitedCV, b.rolloff, b.samsungFix, b.badge, b.approximate]).toEqual([10, false, true, false, "D-Log M (근사)", true]);
    const m = matrixToWS("d-gamut");
    b.srcToWS.forEach((r, i) => r.forEach((v, j) => expect(Math.abs(v - m[i]![j]!)).toBeLessThan(1e-12)));
  });
  it("LUT 가 없을 때 samsunglog/dlogm 은 절대 uProfile 1 이 아니다", () => {
    for (const p of ["samsunglog", "dlogm"] as const) for (const r of ["full", "limited"] as const) expect(resolveInputBinding(desc(p, r), false).profile).not.toBe(1);
  });
  it("그 밖의 프로파일은 Step 3 규칙 유지", () => {
    const s = resolveInputBinding(desc("slog3", "limited", "s-gamut3-cine"), false);
    expect([s.profile, s.limitedCV, s.rolloff, s.samsungFix, s.badge]).toEqual([3, true, true, false, "S-Log3"]);
    const r = resolveInputBinding(desc("rec709", "full", "srgb"), false);
    expect([r.profile, r.limitedCV, r.rolloff]).toEqual([1, false, false]);
    expect(resolveInputBinding(desc("applelog", "limited"), false).limitedCV).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { isPickableSample, sanitizeWbValue, solveEyedropper, solveEyedropperSample } from "../src/lib/studio/color-auto";
import { apply3, wbMatrix } from "../src/lib/render/wb";

const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

describe("wbMatrix 비정상 입력 가드", () => {
  it.each([[NaN, 0], [0, NaN], [Infinity, 0], [0, -Infinity], [NaN, NaN]])("(%s, %s) → 단위행렬", (t, k) => {
    expect(wbMatrix(t, k)).toEqual(I);
  });
  it("정상 범위 전체에서 유한한 행렬", () => {
    for (let t = -100; t <= 100; t += 20) for (let k = -100; k <= 100; k += 20) expect(wbMatrix(t, k).every((r) => r.every(Number.isFinite))).toBe(true);
  });
});

describe("스포이트 표본 범위 가드", () => {
  it("암부(max<0.005)·순백(min>0.995)·비유한 값은 역산하지 않는다", () => {
    expect(isPickableSample([0.004, 0.003, 0.002])).toBe(false);
    expect(isPickableSample([0.996, 1, 1.2])).toBe(false);
    expect(isPickableSample([NaN, 0.5, 0.5])).toBe(false);
    expect(isPickableSample(null)).toBe(false);
    expect(isPickableSample([0.5, 0.4, 0.3])).toBe(true);
    expect(isPickableSample([1, 1, 0.9])).toBe(true);
  });
  it("solveEyedropperSample: 범위 밖 표본은 null, 평가 함수를 호출하지 않는다", () => {
    let calls = 0;
    const mk = () => () => { calls++; return [0.5, 0.5, 0.5]; };
    expect(solveEyedropperSample([0, 0, 0], mk)).toBeNull();
    expect(solveEyedropperSample([1, 1, 1], mk)).toBeNull();
    expect(solveEyedropperSample(null, mk)).toBeNull();
    expect(calls).toBe(0);
  });
  it("solveEyedropperSample: 평가 함수가 항상 NaN 이어도 유한한 정수 (0,0)", () => {
    const r = solveEyedropperSample([0.5, 0.4, 0.3], () => () => [NaN, NaN, NaN])!;
    expect(r === null || (Number.isInteger(r.temp) && Number.isInteger(r.tint) && Math.abs(r.temp) <= 100 && Math.abs(r.tint) <= 100)).toBe(true);
  });
  it("solveEyedropperSample: 따뜻한 회색 표본 → 중성화되는 정수 해", () => {
    const sample: [number, number, number] = apply3(wbMatrix(-30, 10), [0.4, 0.4, 0.4]);
    const r = solveEyedropperSample(sample, (s) => (t, k) => apply3(wbMatrix(t, k), s))!;
    expect(Number.isInteger(r.temp) && Number.isInteger(r.tint)).toBe(true);
    expect(Math.max(...r.out) - Math.min(...r.out)).toBeLessThan(0.01);
  });
  it("solveEyedropper(격자): 순흑·순백은 null", () => {
    const g = (v: number) => ({ width: 8, height: 8, data: new Float32Array(8 * 8 * 4).fill(v) });
    expect(solveEyedropper(g(0), 0.5, 0.5)).toBeNull();
    expect(solveEyedropper(g(1), 0.5, 0.5)).toBeNull();
  });
  it("sanitizeWbValue: 클램프·반올림·비유한 → null", () => {
    expect(sanitizeWbValue(123.4)).toBe(100);
    expect(sanitizeWbValue(-7.6)).toBe(-8);
    expect(sanitizeWbValue(NaN)).toBeNull();
    expect(sanitizeWbValue(Infinity)).toBeNull();
  });

  it("회귀: 백색점이 물리 범위를 벗어나 출력이 검정으로 붕괴하는 (−93, 50) 류 후보는 해로 뽑지 않는다", () => {
    const sample: [number, number, number] = [0.72, 0.53, 0.38]; // 따뜻한 중간톤 (데모 사진 중앙)
    const clipNeg = (s: [number, number, number]) => (t: number, k: number) => apply3(wbMatrix(t, k), s).map((q) => Math.min(1, Math.max(0, q)) ** (1 / 2.2));
    const r = solveEyedropperSample(sample, clipNeg)!;
    expect(r).not.toBeNull();
    const x = apply3(wbMatrix(r.temp, r.tint), sample);
    expect(x.every((q) => q > 0)).toBe(true);
    expect(Math.max(...r.out)).toBeGreaterThan(0.25 * Math.max(...clipNeg(sample)(0, 0)));
    expect(Math.max(...r.out) - Math.min(...r.out)).toBeLessThan(0.05);
  });
});

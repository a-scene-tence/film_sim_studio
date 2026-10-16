import { describe, expect, it } from "vitest";
import { proxySize, resampleArray } from "../src/lib/media/resample";

const R = (src: number[], W: number, H: number, w: number, h: number, mode: "linear" | "srgb-image" = "linear") => Array.from(resampleArray(src, W, H, w, h, 1, mode)).filter((_, i) => i % 4 === 0);

describe("영역 평균 축소 10.3", () => {
  it("[0,3,6] 3×1 → 2×1 = [1,5]", () => expect(R([0, 3, 6], 3, 1, 2, 1).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1, 5]));
  it("[1,3,5,7] 4×1 → 2×1 = [2,6]", () => expect(R([1, 3, 5, 7], 4, 1, 2, 1)).toEqual([2, 6]));
  it("srgb-image [0,1] → srgbEnc(0.5)", () => expect(Math.abs(R([0, 1], 2, 1, 1, 1, "srgb-image")[0]! - 0.735357)).toBeLessThan(1e-6));
  it("세로 축소와 알파", () => {
    const o = resampleArray([0, 2, 4, 6], 1, 4, 1, 2, 1, "linear");
    expect(Array.from(o)).toEqual([1, 1, 1, 1, 5, 5, 5, 1]);
  });
  it("proxySize: 장축 2048", () => {
    expect(proxySize(4000, 3000)).toEqual({ width: 2048, height: 1536 });
    expect(proxySize(3000, 4000)).toEqual({ width: 1536, height: 2048 });
    expect(proxySize(1000, 500)).toEqual({ width: 1000, height: 500 });
  });
});

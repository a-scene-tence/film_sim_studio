import { describe, expect, it } from "vitest";
import { REF_TONE, SHAPER_L } from "@/lib/color/fse/constants.mjs";
import { shaperDec, shaperEnc, srgbDec, tone, toneCoeffs, toneInv } from "@/lib/color/fse/engine.mjs";
import { PRIMARIES, WHITE_D65, rgbToXyzMatrix } from "@/lib/color/fse/lut-domain.mjs";

const near = (actual: number, expected: number, tol: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);

describe("§5 FSH-v1 셰이퍼 골든", () => {
  it("상수와 enc/dec", () => {
    near(SHAPER_L, 13.474058, 1e-6);
    near(shaperEnc(0.18), 0.52035, 1e-6);
    near(shaperEnc(1), 0.703274, 1e-6);
    near(shaperDec(0.5), 0.1486, 1e-6);
    near(shaperEnc(0), 0, 1e-6);
    near(shaperEnc(16), 1, 1e-6);
  });
});

describe("§6.1 톤 계수", () => {
  it("T_ref 골든 b, c", () => {
    const k = toneCoeffs(REF_TONE);
    near(k.b, 0.884006, 1e-6);
    near(k.c, 0.45267, 1e-6);
  });
});

describe("§4.11 Tref⁻¹", () => {
  it("골든", () => {
    near(toneInv(tone(0.5)), 0.5, 1e-6);
    near(toneInv(srgbDec(0.5)), 0.201706, 1e-6);
    expect(toneInv(1)).toBe(2.04);
  });
});

describe("§3 RGB→XYZ 검증값", () => {
  it("sRGB M_RGB→XYZ (±1e-4)", () => {
    const m = rgbToXyzMatrix(PRIMARIES.rec709, WHITE_D65);
    const ref = [
      [0.4124, 0.3576, 0.1805],
      [0.2126, 0.7152, 0.0722],
      [0.0193, 0.1192, 0.9505],
    ];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) near(m[r]![c]!, ref[r]![c]!, 1e-4);
  });
});
// FSE-v1 renderPoint 골든은 FSE-v2 색 전용 커널 골든(tests/fse2.kernel.test.ts)으로 대체됨.

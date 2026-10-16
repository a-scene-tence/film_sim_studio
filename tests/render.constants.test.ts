import { describe, expect, it } from "vitest";
import { SHAPER_L, REF_TONE } from "../src/lib/color/fse/constants.mjs";
import { toneCoeffs } from "../src/lib/color/fse/engine.mjs";
import { COMMON_GLSL } from "../src/lib/render/glsl/common";

const glslConst = (name: string): number => {
  const m = new RegExp(`const float ${name} = ([0-9.eE+-]+);`).exec(COMMON_GLSL);
  if (!m) throw new Error(`GLSL 상수 없음: ${name}`);
  return Number(m[1]);
};

describe("섹션 15.2-1 상수", () => {
  const k = toneCoeffs(REF_TONE);
  it("T_ref b, c (±1e-9)", () => {
    expect(Math.abs(k.b - 0.884006171)).toBeLessThan(1e-9);
    expect(Math.abs(k.c - 0.452670345)).toBeLessThan(1e-9);
  });
  it("SH_L (±1e-9)", () => {
    expect(Math.abs(SHAPER_L - 13.474057982)).toBeLessThan(1e-9);
  });
  it("GLSL common 상수 = FSE 상수", () => {
    expect(Math.abs(glslConst("TREF_B") - k.b)).toBeLessThan(1e-9);
    expect(Math.abs(glslConst("TREF_C") - k.c)).toBeLessThan(1e-9);
    expect(glslConst("TREF_A")).toBe(REF_TONE.a);
    expect(Math.abs(glslConst("TREF_AD") - REF_TONE.a * REF_TONE.d)).toBeLessThan(1e-12);
    expect(glslConst("TREF_HDR")).toBe(REF_TONE.hdrMax);
    expect(glslConst("SH_C")).toBe(0.00140625);
    expect(Math.abs(glslConst("SH_L") - SHAPER_L)).toBeLessThan(1e-9);
    expect(Math.abs(glslConst("DEG") - Math.PI / 180)).toBeLessThan(1e-15);
  });
});

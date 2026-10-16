// Step 4 §5 셰이더 패치 — 소스 문자열 단언(T5), 필름 강도(T6), 흑백 조색(T7), HDF 강도 매핑.
import { describe, expect, it } from "vitest";
import { assembleFragment, PASS_NAMES } from "../src/lib/render/glsl";
import { FS_NORMALIZE_GLSL } from "../src/lib/render/glsl/fs_normalize";
import { FS_MAIN_GLSL } from "../src/lib/render/glsl/fs_main";
import { FS_POST_GLSL } from "../src/lib/render/glsl/fs_post";
import { LIB_OPS_GLSL } from "../src/lib/render/glsl/lib_ops";
import { effectiveParams, DEFAULT_PARAMS, monoTintUniform, scalarUniforms } from "../src/lib/render/params";
import { filmStrengthMix, originalEnc, postChroma } from "../src/lib/render/reference";

const close = (a: ArrayLike<number>, b: number[], tol: number) => b.forEach((v, i) => expect(Math.abs(a[i]! - v)).toBeLessThan(tol));

describe("T5 셰이더 소스 패치 (Step 4 §5)", () => {
  it("프래그먼트 16개 (fs_hist 포함)", () => {
    expect(PASS_NAMES.length).toBe(16);
    expect(PASS_NAMES).toContain("hist");
    expect(assembleFragment("hist")).toContain("outColor = vec4(texture(uIn, uvLocal()).rgb, 1.0);");
  });
  it("fs_normalize: profile 14 Samsung Log 상수", () => {
    expect(FS_NORMALIZE_GLSL).toContain("p == 14");
    for (const c of ["0.206561909", "0.720504856", "0.258984868", "0.0003645", "0.016904", "0.24597", "0.20942"]) expect(FS_NORMALIZE_GLSL).toContain(c);
    expect(FS_NORMALIZE_GLSL).toContain("13 source-lut,14 samsunglog");
  });
  it("lib_ops: uHdfK", () => {
    expect(LIB_OPS_GLSL).toContain("uHdfK * (");
    expect(LIB_OPS_GLSL).toContain("uniform float uHdfK;");
  });
  it("fs_main: lutRaw + uFilmStrength", () => {
    expect(FS_MAIN_GLSL).toContain("vec3 lutRaw(");
    expect(FS_MAIN_GLSL).toContain("uFilmStrength");
    expect(FS_MAIN_GLSL.match(/vec3 lutStage\(/g)?.length).toBe(1);
  });
  it("fs_post: uMonoTint", () => expect(FS_POST_GLSL).toContain("uMonoTint"));
});

describe("T6 필름 강도 JS 미러 (Step 4 §5-3)", () => {
  it("vNone 골든: x=[0.3,0.2,0.1]", () => close(originalEnc([0.3, 0.2, 0.1]), [0.597581, 0.497974, 0.346606], 1e-6));
  it("강도 0.5 혼합 골든", () => close(filmStrengthMix([0.597581, 0.497974, 0.346606], [0.62, 0.4, 0.3], 0.5), [0.608923, 0.452304, 0.324306], 1e-6));
  it("강도 1 은 vSim 그대로, 0 은 vNone", () => {
    expect(filmStrengthMix([0.1, 0.2, 0.3], [0.5, 0.6, 0.7], 1)).toEqual([0.5, 0.6, 0.7]);
    close(filmStrengthMix([0.1, 0.2, 0.3], [0.5, 0.6, 0.7], 0), [0.1, 0.2, 0.3], 1e-12);
  });
  it("uFilmStrength / uHdfK 매핑 = v/100, 기본값은 Step 3 과 동일(1)", () => {
    const d = scalarUniforms(effectiveParams(DEFAULT_PARAMS, false));
    expect([d.uFilmStrength, d.uHdfK]).toEqual([1, 1]);
    const s = scalarUniforms(effectiveParams({ ...DEFAULT_PARAMS, filmStrength: 50, hdfStrength: 150 }, false));
    expect([s.uFilmStrength, s.uHdfK]).toEqual([0.5, 1.5]);
  });
});

describe("T7 흑백 조색 (Step 4 §5-4, §5-6)", () => {
  const tint = (hue: number, amt: number) => monoTintUniform(true, hue, amt);
  it("uMonoTint 매핑 골든 (1e-6)", () => {
    close(tint(70, 50), [0.010261, 0.028191], 1e-6);
    close(tint(250, 100), [-0.020521, -0.056382], 1e-6);
  });
  it("mono 가 아니거나 강도 0 이면 (0,0)", () => {
    expect(monoTintUniform(false, 70, 50)).toEqual([0, 0]);
    expect(tint(70, 0)).toEqual([0, 0]);
  });
  it("픽셀 골든 (1e-5)", () => {
    close(postChroma([0.5, 0.5, 0.5], 0, 0, 0, null, tint(70, 50)), [0.547547, 0.489872, 0.426127], 1e-5);
    close(postChroma([0.5, 0.5, 0.5], 0, 0, 0, null, tint(250, 100)), [0.393596, 0.512882, 0.637721], 1e-5);
    close(postChroma([0, 0, 0], 0, 0, 0, null, tint(70, 100)), [0, 0, 0], 1e-5);
  });
});

describe("스튜디오 절대 모드: 레시피 레이어를 더하지 않는다", () => {
  it("absolute=true 이면 adjust 가 그대로 실효값", () => {
    const p = { ...DEFAULT_PARAMS, sim: "ricoh-hdr-tone", absolute: true, adjust: { ...DEFAULT_PARAMS.adjust, clarity: 5 } };
    const e = effectiveParams(p, false);
    expect(e.adjust.clarity).toBe(5);
    expect(e.adjust.sharpen).toBe(0);
    expect(e.hdf).toBe(false);
    expect(effectiveParams({ ...p, absolute: false }, false).adjust.clarity).toBe(75);
  });
});

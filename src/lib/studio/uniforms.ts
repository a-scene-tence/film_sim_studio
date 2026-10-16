// Step 4 §5-6, §6-2 "렌더 매핑" — EditState → Step 3 RenderParams → 셰이더 스칼라. 수식은 여기와 Step 3 params.ts 에만 둔다.
import { effectiveParams, scalarUniforms, ZERO_ADJUST, type Level, type RenderParams, type ScalarUniforms } from "../render/params";
import { toCurveState, type EditState } from "./state";

export interface BuildOptions {
  /** EXIF ISO (acros 그레인 규칙은 selectSim 에서 이미 슬라이더에 반영되므로 렌더에는 영향 없음) */
  iso?: number | null;
  sourceLutId?: string | null;
  lookLutId?: string | null;
}

/** 스튜디오는 절대 모드: 슬라이더 값이 곧 실효값이다 (레시피는 selectSim 이 슬라이더에 복사) */
export function buildRenderParams(st: EditState, o: BuildOptions = {}): RenderParams {
  return {
    sim: st.simId ?? "none",
    lookLutId: o.lookLutId ?? null,
    sourceLutId: o.sourceLutId ?? null,
    adjust: {
      ...ZERO_ADJUST,
      exposure: st.exposure, lightBalance: st.lightBalance, brightness: st.brightness, contrast: st.contrast,
      highlights: st.highlights, shadows: st.shadows, whites: st.whites, blacks: st.blacks,
      temp: st.temp, tint: st.tint, saturation: st.saturation, vibrance: st.vibrance,
      clarity: st.clarity, sharpen: st.sharpness, dehaze: st.dehaze, vignette: st.vignette,
      grainAmount: st.grainAmount, grainSize: st.grainSize,
    },
    cce: st.cce as Level,
    fxb: st.ccb as Level,
    hdf: st.hdf,
    curve: toCurveState(st.curve),
    iso: o.iso ?? null,
    filmStrength: st.filmStrength,
    hdfStrength: st.hdfStrength,
    monoHue: st.monoHue,
    monoAmount: st.monoAmount,
    absolute: true,
  };
}

/** 셰이더 스칼라 유니폼 (mono = 필름이 흑백인지) */
export function buildUniforms(st: EditState, mono: boolean, o: BuildOptions = {}): ScalarUniforms {
  return scalarUniforms(effectiveParams(buildRenderParams(st, o), mono));
}

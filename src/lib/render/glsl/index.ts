// 섹션 4.2-8 셰이더 조립: header + common + lib_ops + 각 패스 본문 순서로 연결한다.
import { COMMON_GLSL } from "./common";
import { FS_FINAL_GLSL } from "./fs_final";
import { FS_HIST_GLSL } from "./fs_hist";
import { FS_MAIN_GLSL } from "./fs_main";
import { FS_NORMALIZE_GLSL } from "./fs_normalize";
import { FS_POST_GLSL } from "./fs_post";
import {
  FS_BLURL_GLSL, FS_BOX_GLSL, FS_DOWN2_GLSL, FS_DZ_Q_GLSL, FS_DZ_TT_GLSL, FS_GAUSS_GLSL, FS_GF_AB_GLSL,
  FS_HDF_EXTRACT_GLSL, FS_MIN7_GLSL, FS_PREP_GLSL, FS_PROBE_GLSL,
} from "./fs_small";
import { HEADER_GLSL } from "./header";
import { LIB_OPS_GLSL } from "./lib_ops";
import { VS_GLSL } from "./vs";

export { COMMON_GLSL, HEADER_GLSL, LIB_OPS_GLSL, VS_GLSL };

export type PassName =
  | "normalize" | "hdf_extract" | "down2" | "gauss" | "box" | "gf_ab" | "min7" | "prep"
  | "dz_tt" | "dz_q" | "main" | "post" | "blurL" | "final" | "probe" | "hist";

/** 16개 프래그먼트 패스 본문 (Step 4 에서 hist 추가) */
export const PASS_BODIES: Readonly<Record<PassName, string>> = Object.freeze({
  normalize: FS_NORMALIZE_GLSL,
  hdf_extract: FS_HDF_EXTRACT_GLSL,
  down2: FS_DOWN2_GLSL,
  gauss: FS_GAUSS_GLSL,
  box: FS_BOX_GLSL,
  gf_ab: FS_GF_AB_GLSL,
  min7: FS_MIN7_GLSL,
  prep: FS_PREP_GLSL,
  dz_tt: FS_DZ_TT_GLSL,
  dz_q: FS_DZ_Q_GLSL,
  main: FS_MAIN_GLSL,
  post: FS_POST_GLSL,
  blurL: FS_BLURL_GLSL,
  final: FS_FINAL_GLSL,
  probe: FS_PROBE_GLSL,
  hist: FS_HIST_GLSL,
});

export const PASS_NAMES = Object.keys(PASS_BODIES) as PassName[];

/** header + common + lib_ops + 본문 */
export function assembleFragment(pass: PassName): string {
  return HEADER_GLSL + COMMON_GLSL + LIB_OPS_GLSL + PASS_BODIES[pass];
}

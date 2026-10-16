// Step 4 §4-3 resolveInputBinding — 입력 프로파일 → fs_normalize 유니폼 결정. Samsung Log / D-Log M 은 LUT 가 없어도
// 절대 Rec.709(profile 1) 로 폴백하지 않는다. 사용자 공식 LUT(profile 13)가 있으면 내장 변환보다 우선한다.
import { matrixToWS } from "../color/source/primaries.mjs";
import type { SourceDescriptor, SourceProfileId } from "../media-loader";
import { renderErrors } from "./gl";
import { IDENTITY3, type Mat3 } from "./wb";

export const PROFILE_INDEX: Readonly<Record<string, number>> = {
  "srgb-image": 0, rec709: 1, hlg: 2, slog3: 3, slog2: 4, flog: 5, flog2: 6, clog3: 7, vlog: 8, nlog: 9, dlog: 10, applelog: 11, "raw-linear": 12, samsunglog: 14,
};

export const PROFILE_LABEL: Readonly<Record<SourceProfileId, string>> = {
  "srgb-image": "sRGB 이미지", rec709: "Rec.709", hlg: "HLG", pq: "PQ", slog3: "S-Log3", slog2: "S-Log2", flog: "F-Log", flog2: "F-Log2", clog3: "C-Log3",
  vlog: "V-Log", nlog: "N-Log", dlog: "D-Log", applelog: "Apple Log", samsunglog: "Samsung Log", dlogm: "D-Log M", "raw-linear": "RAW 선형",
};

export interface InputBinding {
  /** uProfile */
  profile: number;
  limitedCV: boolean;
  srcToWS: Mat3;
  rolloff: boolean;
  samsungFix: boolean;
  /** true 면 사용자 공식 LUT(profile 13) */
  useSourceLut: boolean;
  badge: string;
  approximate: boolean;
}

const isOfficial = (p: SourceProfileId) => p === "samsunglog" || p === "dlogm";

/** @param userLut 해당 프로파일용 사용자 LUT(role source-transform)가 등록·로드되어 있는지 */
export function resolveInputBinding(d: SourceDescriptor, userLut: boolean): InputBinding {
  if (d.profile === "pq") throw renderErrors.pq();
  if (isOfficial(d.profile)) {
    const label = PROFILE_LABEL[d.profile];
    if (userLut) {
      return { profile: 13, limitedCV: false, srcToWS: IDENTITY3, rolloff: false, samsungFix: d.profile === "samsunglog", useSourceLut: true, badge: `${label} · LUT`, approximate: false };
    }
    if (d.profile === "samsunglog") {
      return {
        profile: 14, limitedCV: d.range !== "full", srcToWS: matrixToWS("rec2020") as Mat3, rolloff: true, samsungFix: true, useSourceLut: false, badge: "Samsung Log", approximate: false,
      };
    }
    return { profile: 10, limitedCV: false, srcToWS: matrixToWS("d-gamut") as Mat3, rolloff: true, samsungFix: false, useSourceLut: false, badge: "D-Log M (근사)", approximate: true };
  }
  const profile = PROFILE_INDEX[d.profile];
  if (profile === undefined) throw renderErrors.noSource();
  return {
    profile,
    limitedCV: profile >= 3 && profile <= 9 && d.range === "limited",
    srcToWS: matrixToWS(d.primaries) as Mat3,
    rolloff: profile >= 2 && profile <= 11,
    samsungFix: false,
    useSourceLut: false,
    badge: PROFILE_LABEL[d.profile],
    approximate: false,
  };
}

// Step 4 §7-3 입력 색공간 시트 — UI 선택 ↔ 소스 프로파일 / resolveInputBinding 결과 문구.
import type { LogDetection, SourceProfileId } from "../media-loader";
import { PROFILE_LABEL, type InputBinding } from "../render/binding";

export type InputChoice = "auto" | SourceProfileId;

/** 라디오 목록 (Auto 다음 순서) */
export const MAIN_CHOICES: ReadonlyArray<SourceProfileId> = ["slog3", "applelog", "samsunglog", "flog2", "dlogm", "rec709"];
/** 접이식 "기타 프로파일" */
export const MORE_CHOICES: ReadonlyArray<SourceProfileId> = ["slog2", "flog", "clog3", "vlog", "nlog", "hlg"];

/** 시트 라디오 라벨 (D-Log M 은 반드시 "근사" 표기) */
export function choiceLabel(p: SourceProfileId): string {
  return p === "dlogm" ? "D-Log M (근사)" : PROFILE_LABEL[p];
}

/** Auto 가 가리키는 프로파일: 로더가 자동 적용한 값 (감지가 제안이거나 없으면 Rec.709) */
export function autoProfile(det: LogDetection | null, isImage: boolean): SourceProfileId {
  if (det && det.autoApply) return det.profile;
  return isImage ? "srgb-image" : "rec709";
}

export const detectedLabel = (det: LogDetection | null): string => (det ? choiceLabel(det.profile) : "감지 없음");

/** 헤더 배지 문구: RAW 는 "RAW", Auto 는 "Auto · {라벨}", 아니면 바인딩 문구 */
export function badgeText(o: { isRaw: boolean; auto: boolean; binding: InputBinding | null; fallback: string }): string {
  if (o.isRaw) return "RAW";
  const text = o.binding?.badge ?? o.fallback;
  return o.auto ? `Auto · ${text}` : text;
}

/** §4-5 행 보조 문구 */
export function profileNote(p: SourceProfileId, lutName: string | null): string | null {
  if (p !== "samsunglog" && p !== "dlogm") return null;
  if (lutName) return `등록한 LUT 사용 중: ${lutName}`;
  return p === "samsunglog"
    ? "내장 공식 변환(Samsung Log White Paper) 사용 중"
    : "내장 근사 변환(D-Log 곡선 + D-Gamut). DJI 공식 D-Log M→Rec.709 LUT 를 등록하면 정확하게 변환됩니다.";
}

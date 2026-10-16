"use client";
// 스튜디오 공용 상태: useReducer + React Context 하나 (외부 스토어 금지, Step 4 §7-8)
import { createContext, useContext, type Dispatch } from "react";
import type { MediaAsset } from "@/lib/media-loader";
import type { FilmRenderer } from "@/lib/render/renderer";
import type { EditAction, EditState, SimInfo } from "@/lib/studio/state";
import type { ToastFn } from "./Toast";

export interface StudioCtx {
  state: EditState;
  /** 단발성 조작: 즉시 히스토리 1단계로 기록 */
  dispatch: Dispatch<EditAction>;
  /** 드래그 중 실시간 갱신 (히스토리에 쌓지 않는다) */
  live: Dispatch<EditAction>;
  /** 드래그 시작: 기준 상태 기억 */
  beginEdit(): void;
  /** 드래그 확정: 값이 달라졌다면 1단계로 기록 */
  commitEdit(): void;
  sims: ReadonlyArray<SimInfo>;
  /** EXIF ISO (acros 그레인 규칙) */
  iso: number | null;
  asset: MediaAsset | null;
  file: File | null;
  renderer: FilmRenderer | null;
  toast: ToastFn;
  /** 현재 필름이 흑백인가 (simRecipe(simId).mono) */
  mono: boolean;
  /** 필름 카드 썸네일 (키 = sim id, 필름 없음은 "none") */
  thumbs: Readonly<Record<string, string>>;
  /** 정보 · 고지 시트 열기 */
  openAbout(): void;
  /** 에디터가 비어 있으면 탭 비활성 */
  hasMedia: boolean;
}

export const StudioContext = createContext<StudioCtx | null>(null);

export function useStudio(): StudioCtx {
  const c = useContext(StudioContext);
  if (!c) throw new Error("StudioContext 밖에서 useStudio 를 호출했습니다");
  return c;
}

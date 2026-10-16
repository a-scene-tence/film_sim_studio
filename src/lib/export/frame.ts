// Step 5 §1 EXIF 필름 프레임: 여백 레이아웃·각인 문구 계산 (순수 함수 — 테스트 가능, DOM 의존 없음).
import type { ExifSummary } from "../exif-manager";

export type FrameTheme = "white" | "dark";
export type FrameLayout = "bottom" | "polaroid";

export interface FrameOptions { enabled: boolean; theme: FrameTheme; layout: FrameLayout }
export const defaultFrameOptions = (): FrameOptions => ({ enabled: false, theme: "white", layout: "bottom" });

export interface FrameGeometry {
  /** 프레임을 포함한 출력 크기 */
  width: number; height: number;
  /** 사진이 놓이는 좌상단 */
  photoX: number; photoY: number;
  /** 사진 아래 각인 영역 (캔버스 전체 폭) */
  bar: { x: number; y: number; width: number; height: number };
  /** 글자 정렬: 하단 여백형은 왼쪽, 폴라로이드형은 가운데 */
  align: "left" | "center";
  /** 글자 크기·여백 (px) */
  mainSize: number; subSize: number; pad: number;
}

const even = (n: number) => 2 * Math.round(n / 2);

/** 짧은 변 s 기준 비율: 하단형 바 = 0.15 s, 폴라로이드 = 4면 0.05 s + 하단 0.19 s */
export function frameGeometry(W: number, H: number, layout: FrameLayout): FrameGeometry {
  const s = Math.max(1, Math.min(W, H));
  if (layout === "polaroid") {
    const b = Math.max(2, even(s * 0.05));
    const bottom = Math.max(8, even(s * 0.19));
    return {
      width: W + 2 * b, height: H + b + bottom, photoX: b, photoY: b,
      bar: { x: 0, y: b + H, width: W + 2 * b, height: bottom }, align: "center",
      mainSize: Math.max(8, Math.round(bottom * 0.2)), subSize: Math.max(6, Math.round(bottom * 0.135)), pad: b,
    };
  }
  const bar = Math.max(8, even(s * 0.15));
  return {
    width: W, height: H + bar, photoX: 0, photoY: 0, bar: { x: 0, y: H, width: W, height: bar }, align: "left",
    mainSize: Math.max(8, Math.round(bar * 0.26)), subSize: Math.max(6, Math.round(bar * 0.17)), pad: Math.max(4, Math.round(bar * 0.45)),
  };
}

export interface FrameColors { bg: string; main: string; sub: string; badgeBg: string; badgeText: string }
export const FRAME_COLORS: Readonly<Record<FrameTheme, FrameColors>> = {
  white: { bg: "#ffffff", main: "#141414", sub: "#6b6b6b", badgeBg: "#141414", badgeText: "#ffffff" },
  dark: { bg: "#0b0b0c", main: "#f2f2f2", sub: "#9a9a9a", badgeBg: "#f2f2f2", badgeText: "#0b0b0c" },
};
const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
export const frameBackground = (t: FrameTheme): [number, number, number] => hex(FRAME_COLORS[t].bg);

export interface FrameText {
  /** 1줄: 카메라 바디 · 렌즈 */
  main: string;
  /** 2줄: 초점거리 · 조리개 · 셔터 · ISO · 촬영일시 */
  sub: string;
  /** 필름 시뮬레이션 배지 (예: "FUJIFILM Classic Neg." / "RICOH Positive Film + HDF") */
  badge: string;
}

const dash = (v: string | null | undefined): string | null => (v && v.trim() && v !== "—" ? v.trim() : null);

/** 요약의 "35mm (35mm 환산 52.5mm)" → "35mm" */
export const shortFocal = (v: string | null | undefined): string | null => {
  const t = dash(v);
  return t ? t.replace(/\s*\(.*\)\s*$/, "") : null;
};
/** 셔터 "1/250" → "1/250s", "2.5초" → "2.5s" */
export const shortShutter = (v: string | null | undefined): string | null => {
  const t = dash(v);
  if (!t) return null;
  return t.replace(/\s*(초|s)$/, "") + "s";
};
/** "ISO 400" → "ISO 400" (접두 보정), 숫자만 있으면 접두 추가 */
export const shortIso = (v: string | null | undefined): string | null => {
  const t = dash(v);
  if (!t) return null;
  return /^ISO/i.test(t) ? t : `ISO ${t}`;
};
/** "2026.10.16 06:39:00 +09:00" → "2026.10.16 06:39" (파일 수정 시각 대체값은 각인하지 않는다) */
export const shortDate = (v: string | null | undefined): string | null => {
  const t = dash(v);
  if (!t || t.includes("파일 수정 시각")) return null;
  const m = /^(\d{4}\.\d{2}\.\d{2})(?: (\d{2}:\d{2}))?/.exec(t);
  return m ? (m[2] ? `${m[1]} ${m[2]}` : m[1]!) : null;
};

/** 필름 배지: 브랜드 + 영문 이름(+ HDF). 필름 없음은 "Original" */
export function filmBadgeLabel(sim: { brand: "fujifilm" | "ricoh"; en?: string; ko?: string } | null, hdf: boolean): string {
  if (!sim) return hdf ? "Original + HDF" : "Original";
  const brand = sim.brand === "fujifilm" ? "FUJIFILM" : "RICOH";
  const name = (sim.en ?? sim.ko ?? "").trim();
  const base = name.toUpperCase().startsWith(brand) ? name : `${brand} ${name}`.trim();
  return hdf ? `${base} + HDF` : base;
}

/** EXIF 요약 + 배지 → 각인 문구. 정보가 없는 항목은 빼고 구분자 · 로 잇는다 */
export function buildFrameText(summary: Partial<ExifSummary> | null | undefined, badge: string): FrameText {
  const sm = summary ?? {};
  const main = [dash(sm.body), dash(sm.lens)].filter((x): x is string => x !== null).join("  ·  ");
  const sub = [shortFocal(sm.focalLength), dash(sm.aperture), shortShutter(sm.shutter), shortIso(sm.iso), shortDate(sm.dateTime)]
    .filter((x): x is string => x !== null).join("  ·  ");
  return { main: main || "Film Lab", sub, badge };
}

/** 너비에 맞을 때까지 글자 크기를 줄인다 (measure = 크기 → 폭). 최소 6px */
export function fitFontSize(size: number, maxWidth: number, measure: (px: number) => number): number {
  let s = size;
  while (s > 6 && measure(s) > maxWidth) s -= 1;
  return s;
}

/** 프레임 포함 크기 (메모리 계획·EXIF PixelDimension 용). 프레임이 꺼져 있으면 그대로 */
export function framedSize(W: number, H: number, f: FrameOptions): { width: number; height: number } {
  if (!f.enabled) return { width: W, height: H };
  const g = frameGeometry(W, H, f.layout);
  return { width: g.width, height: g.height };
}

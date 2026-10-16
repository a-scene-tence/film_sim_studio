// Step 5 §1 프레임 합성: 사진 RGBA 를 여백 캔버스에 복사하고, 각인 영역은 OffscreenCanvas(2D)로 그려 붙인다.
// 워커에서 실행한다 (메인 스레드 블로킹 금지). 폰트는 시스템 폰트만 쓴다 (제3자 폰트 요청 금지).
import { FRAME_COLORS, fitFontSize, frameBackground, frameGeometry, type FrameGeometry, type FrameLayout, type FrameText, type FrameTheme } from "./frame";

export const FRAME_FONT = '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard", "Noto Sans KR", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** 배경색으로 채운 (width×height) RGBA 위에 사진을 (photoX, photoY) 로 복사한다. 순수 픽셀 연산 */
export function composePhoto(photo: Uint8ClampedArray, W: number, H: number, g: FrameGeometry, theme: FrameTheme): Uint8ClampedArray {
  const out = new Uint8ClampedArray(g.width * g.height * 4);
  const [r, gg, b] = frameBackground(theme);
  for (let i = 0; i < out.length; i += 4) { out[i] = r; out[i + 1] = gg; out[i + 2] = b; out[i + 3] = 255; }
  for (let y = 0; y < H; y++) out.set(photo.subarray(y * W * 4, (y + 1) * W * 4), ((g.photoY + y) * g.width + g.photoX) * 4);
  return out;
}

/** 최소 2D 컨텍스트 면 (테스트에서 목으로 대체) */
export interface TextCtx {
  font: string; fillStyle: string | CanvasGradient | CanvasPattern; textBaseline: CanvasTextBaseline; textAlign: CanvasTextAlign;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(t: string, x: number, y: number): void;
  measureText(t: string): { width: number };
  beginPath(): void; closePath(): void; fill(): void;
  roundRect?(x: number, y: number, w: number, h: number, r: number): void;
  rect(x: number, y: number, w: number, h: number): void;
}

/** 각인 영역(g.bar)을 (0,0) 기준으로 그린다 */
export function drawFrameText(ctx: TextCtx, g: FrameGeometry, text: FrameText, theme: FrameTheme): void {
  const col = FRAME_COLORS[theme];
  const { width: bw, height: bh } = g.bar;
  ctx.fillStyle = col.bg;
  ctx.fillRect(0, 0, bw, bh);
  ctx.textBaseline = "middle";
  const maxW = bw - 2 * g.pad;
  const center = g.align === "center";

  // 1줄: 바디 · 렌즈
  const mainFont = (px: number) => `600 ${px}px ${FRAME_FONT}`;
  const mainPx = fitFontSize(g.mainSize, maxW, (px) => { ctx.font = mainFont(px); return ctx.measureText(text.main).width; });
  ctx.font = mainFont(mainPx);
  ctx.fillStyle = col.main;
  const y1 = bh * (center ? 0.34 : 0.36);
  ctx.textAlign = center ? "center" : "left";
  ctx.fillText(text.main, center ? bw / 2 : g.pad, y1);

  // 2줄: 촬영 정보 + 필름 배지(알약)
  const subFont = (px: number) => `400 ${px}px ${FRAME_FONT}`;
  const badgeFont = (px: number) => `700 ${Math.round(px * 0.9)}px ${FRAME_FONT}`;
  const gap = Math.round(g.subSize * 0.9);
  const padX = Math.round(g.subSize * 0.7);
  const widthAt = (px: number) => {
    ctx.font = subFont(px);
    const sw = text.sub ? ctx.measureText(text.sub).width : 0;
    ctx.font = badgeFont(px);
    return sw + (text.sub ? gap : 0) + ctx.measureText(text.badge).width + 2 * padX;
  };
  const subPx = fitFontSize(g.subSize, maxW, widthAt);
  ctx.font = subFont(subPx);
  const subW = text.sub ? ctx.measureText(text.sub).width : 0;
  ctx.font = badgeFont(subPx);
  const pillW = ctx.measureText(text.badge).width + 2 * padX;
  const pillH = Math.round(subPx * 1.7);
  const total = subW + (text.sub ? gap : 0) + pillW;
  const x0 = center ? (bw - total) / 2 : g.pad;
  const y2 = bh * (center ? 0.66 : 0.7);
  ctx.textAlign = "left";
  if (text.sub) {
    ctx.font = subFont(subPx);
    ctx.fillStyle = col.sub;
    ctx.fillText(text.sub, x0, y2);
  }
  const px = x0 + subW + (text.sub ? gap : 0);
  const py = y2 - pillH / 2;
  ctx.fillStyle = col.badgeBg;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(px, py, pillW, pillH, pillH / 2); else ctx.rect(px, py, pillW, pillH);
  ctx.closePath();
  ctx.fill();
  ctx.font = badgeFont(subPx);
  ctx.fillStyle = col.badgeText;
  ctx.fillText(text.badge, px + padX, y2 + 0.5);
}

/** 사진 + 여백 + 각인을 합친 RGBA. OffscreenCanvas 가 없으면 여백만 있는 결과를 돌려주지 않고 예외를 던진다 */
export function renderFramed(photo: Uint8ClampedArray, W: number, H: number, layout: FrameLayout, theme: FrameTheme, text: FrameText): { rgba: Uint8ClampedArray; width: number; height: number } {
  const g = frameGeometry(W, H, layout);
  const rgba = composePhoto(photo, W, H, g, theme);
  if (typeof OffscreenCanvas === "undefined") throw new Error("이 브라우저는 프레임 각인(OffscreenCanvas)을 지원하지 않습니다 — 프레임을 끄고 저장하거나 최신 브라우저에서 다시 시도하세요.");
  const oc = new OffscreenCanvas(g.bar.width, g.bar.height);
  const ctx = oc.getContext("2d");
  if (!ctx) throw new Error("프레임 각인용 2D 캔버스를 만들지 못했습니다 — 다시 시도하세요");
  drawFrameText(ctx as unknown as TextCtx, g, text, theme);
  const bar = ctx.getImageData(0, 0, g.bar.width, g.bar.height).data;
  for (let y = 0; y < g.bar.height; y++) {
    rgba.set(bar.subarray(y * g.bar.width * 4, (y + 1) * g.bar.width * 4), ((g.bar.y + y) * g.width + g.bar.x) * 4);
  }
  return { rgba, width: g.width, height: g.height };
}

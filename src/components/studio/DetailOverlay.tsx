"use client";
// Step 4 §8-6 확대 디테일 오버레이 (사진 전용): z ≥ 2 에서 입력이 300ms 없으면 보이는 영역을 풀해상도 타일로 다시 그린다.
import { useEffect, useRef } from "react";
import type { MediaAsset } from "@/lib/media-loader";
import { tilePadding } from "@/lib/render/plan";
import type { FilmRenderer } from "@/lib/render/renderer";
import { visibleRegion, type Geometry, type ZoomState } from "@/lib/studio/gestures";

const IDLE_MS = 300;
const MAX_LONG = 2048;

export function DetailOverlay({ renderer, asset, zoom, geometry, editKey }: { renderer: FilmRenderer; asset: MediaAsset; zoom: ZoomState; geometry: Geometry; editKey: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const rectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const hide = () => { c.style.display = "none"; };
    hide();
    if (zoom.z < 2 || asset.kind === "video" || asset.previewOnly) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const reg = visibleRegion(zoom, geometry);
        if (!reg) return;
        const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
        const W = asset.displaySize.width, H = asset.displaySize.height;
        let ow = Math.max(1, Math.round(reg.rect.w * dpr)), oh = Math.max(1, Math.round(reg.rect.h * dpr));
        const k = Math.min(1, MAX_LONG / Math.max(ow, oh));
        ow = Math.max(1, Math.round(ow * k));
        oh = Math.max(1, Math.round(oh * k));
        const regW = (reg.u1 - reg.u0) * W;
        const s = Math.min(1, ow / regW);
        const outFull = { width: Math.round(W * s), height: Math.round(H * s) };
        const x0 = Math.min(outFull.width - 1, Math.round(reg.u0 * outFull.width));
        const y0 = Math.min(outFull.height - 1, Math.round(reg.v0 * outFull.height));
        const w = Math.min(ow, outFull.width - x0), h = Math.min(oh, outFull.height - y0);
        if (w < 1 || h < 1) return;
        const P = tilePadding(outFull);
        const T = Math.min(1024, Math.floor(2048 * s) - 2 * P - 96);
        if (T < 64) return;
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        try {
          for (let ty = 0; ty < h; ty += T) {
            for (let tx = 0; tx < w; tx += T) {
              if (cancelled) return;
              const rw = Math.min(T, w - tx), rh = Math.min(T, h - ty);
              const px = await renderer.renderTile({ rect: { x: x0 + tx, y: y0 + ty, width: rw, height: rh }, outScale: s });
              if (cancelled) return;
              ctx.putImageData(new ImageData(new Uint8ClampedArray(px), rw, rh), tx, ty);
            }
          }
        } catch {
          return; // 렌더 체인이 바뀌었거나(stale) 타일이 너무 크면 오버레이 없이 프리뷰를 그대로 둔다
        }
        if (cancelled) return;
        rectRef.current = reg.rect;
        c.style.left = `${reg.rect.x}px`;
        c.style.top = `${reg.rect.y}px`;
        c.style.width = `${reg.rect.w}px`;
        c.style.height = `${reg.rect.h}px`;
        c.style.display = "block";
      })();
    }, IDLE_MS);
    return () => { cancelled = true; clearTimeout(timer); hide(); };
  }, [renderer, asset, zoom, geometry, editKey]);

  return <canvas ref={canvas} className="pointer-events-none absolute z-[5]" style={{ display: "none" }} aria-hidden="true" />;
}

"use client";
// Step 4 §8-4 히스토그램: 프리뷰 좌상단 132×72 CSS px, 내부 256×100 캔버스. 탭하면 접고 편다(localStorage filmlab.ui.histogram).
import { useCallback, useEffect, useRef, useState } from "react";
import { binPixels, clipFlags, histHeights } from "@/lib/studio/histogram";
import type { FilmRenderer } from "@/lib/render/renderer";

const KEY = "filmlab.ui.histogram";

function readOpen(): boolean {
  try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
}

export function Histogram({ renderer, tick, playing, active }: { renderer: FilmRenderer | null; tick: string; playing: boolean; active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [open, setOpen] = useState(true);
  useEffect(() => { queueMicrotask(() => setOpen(readOpen())); }, []);

  const draw = useCallback((pixels: Uint8Array) => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const b = binPixels(pixels);
    ctx.clearRect(0, 0, 256, 100);
    ctx.globalCompositeOperation = "lighter";
    const fill = (bins: Uint32Array, color: string) => {
      const h = histHeights(bins);
      ctx.fillStyle = color;
      for (let i = 0; i < 256; i++) { const hh = h[i]! * 100; ctx.fillRect(i, 100 - hh, 1, hh); }
    };
    fill(b.R, "rgba(255,77,77,0.55)");
    fill(b.G, "rgba(77,255,136,0.55)");
    fill(b.B, "rgba(77,140,255,0.55)");
    ctx.globalCompositeOperation = "source-over";
    const hl = histHeights(b.L);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 256; i++) { const y = 100 - hl[i]! * 100; if (i === 0) ctx.moveTo(i, y); else ctx.lineTo(i, y); }
    ctx.stroke();
    const f = clipFlags(b);
    if (f.shadow) { ctx.fillStyle = "#4d8cff"; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(6, 0); ctx.lineTo(0, 6); ctx.fill(); }
    if (f.highlight) { ctx.fillStyle = "#ff453a"; ctx.beginPath(); ctx.moveTo(256, 0); ctx.lineTo(250, 0); ctx.lineTo(256, 6); ctx.fill(); }
  }, []);

  // 사진은 편집 후 150ms, 재생 중인 비디오는 250ms 간격으로 계산한다
  useEffect(() => {
    if (!renderer || !open || !active) return;
    if (playing) {
      let alive = true;
      const id = setInterval(() => { void renderer.requestHistogram().then((h) => { if (alive && h) draw(h.data); }); }, 250);
      return () => { alive = false; clearInterval(id); };
    }
    let alive = true;
    const id = setTimeout(() => { void renderer.requestHistogram().then((h) => { if (alive && h) draw(h.data); }); }, 150);
    return () => { alive = false; clearTimeout(id); };
  }, [renderer, open, active, playing, tick, draw]);

  const toggle = () => {
    setOpen((o) => {
      try { localStorage.setItem(KEY, o ? "0" : "1"); } catch { /* 저장소 접근 불가 */ }
      return !o;
    });
  };

  return (
    <button
      type="button" aria-label={open ? "히스토그램 접기" : "히스토그램 펼치기"} aria-pressed={open}
      className="absolute left-2 top-2 z-10 overflow-hidden rounded-[8px]"
      style={{ width: open ? 132 : 44, height: open ? 72 : 44, background: "rgba(0,0,0,0.45)" }} onClick={toggle}
    >
      <canvas ref={canvas} width={256} height={100} className="h-full w-full" style={{ display: open ? "block" : "none" }} />
      {open ? null : <span className="text-[11px] text-white/80">Hist</span>}
    </button>
  );
}

"use client";
// Step 4 §8 프리뷰: 캔버스·줌/팬·길게 눌러 원본 비교·히스토그램·HDF 토글·디테일 오버레이·동영상 컨트롤
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { MediaAsset } from "@/lib/media-loader";
import type { FilmRenderer } from "@/lib/render/renderer";
import { containSize, doubleTapZoom, isDoubleTap, LONG_PRESS_MS, LONG_PRESS_SLOP, pan, pinch, pointToImageUV, type Geometry, type PinchStart, type Vec2, type ZoomState } from "@/lib/studio/gestures";
import { DetailOverlay } from "./DetailOverlay";
import { HdfToggle } from "./HdfToggle";
import { IconClose, IconFullscreen } from "./icons";
import { useFullscreenPreview } from "./useFullscreenPreview";
import { Histogram } from "./Histogram";
import { VideoBar } from "./VideoBar";

const ONE: ZoomState = { z: 1, t: { x: 0, y: 0 } };

/** 표시 이미지 크기 (회전 반영) */
export function assetDisplaySize(a: MediaAsset): { width: number; height: number } {
  if (a.kind === "video" && a.video) {
    const r = a.video.rotation;
    return r.orientation >= 5 ? { width: r.codedHeight, height: r.codedWidth } : { width: r.codedWidth, height: r.codedHeight };
  }
  return a.displaySize;
}

export interface PreviewProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  renderer: FilmRenderer | null;
  asset: MediaAsset | null;
  hdf: boolean;
  onToggleHdf(): void;
  compare: boolean;
  onCompare(on: boolean): void;
  /** 편집 상태 서명 (오버레이·히스토그램 갱신 트리거) */
  editKey: string;
  disabled: boolean;
  pauseVideoSignal: number;
  /** WB 스포이트 모드: 줌/팬/비교 대신 탭 지점을 onPick(u, v) 로 알린다 (u,v = 표시 이미지 정규화 좌표) */
  picking?: boolean;
  onPick?(u: number, v: number): void;
  /** 스포이트로 찍은 지점 표시 (u,v = 표시 이미지 정규화 좌표). null 이면 숨김 */
  pickMarker?: { u: number; v: number; key: number } | null;
  children?: React.ReactNode;
}

export function Preview(props: PreviewProps) {
  const { canvasRef, renderer, asset, hdf, onToggleHdf, compare, onCompare, editKey, disabled, pauseVideoSignal, picking = false, onPick, pickMarker = null, children } = props;
  const box = useRef<HTMLDivElement>(null);
  const fs = useFullscreenPreview(box);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<ZoomState>(ONE);
  const [zoomLabel, setZoomLabel] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const zoomRef = useRef<ZoomState>(ONE);
  const ptrs = useRef(new Map<number, Vec2>());
  const pinchStart = useRef<PinchStart | null>(null);
  const single = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickStart = useRef<{ id: number; x: number; y: number } | null>(null);
  const comparing = useRef(false);
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);
  const labelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    queueMicrotask(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    return () => ro.disconnect();
  }, []);

  const disp = asset ? assetDisplaySize(asset) : null;
  const fit = useMemo(() => (disp && size.w > 0 && size.h > 0 ? containSize(disp.width, disp.height, size.w, size.h) : null), [disp, size.w, size.h]);
  const geometry: Geometry | null = fit ? { Wc: size.w, Hc: size.h, bw: fit.bw, bh: fit.bh } : null;

  // 새 미디어면 줌 초기화
  const assetId = asset?.id ?? null;
  useEffect(() => { zoomRef.current = ONE; queueMicrotask(() => setZoom(ONE)); }, [assetId]);

  const commit = useCallback((next: ZoomState) => {
    const prevZ = zoomRef.current.z;
    zoomRef.current = next;
    setZoom(next);
    if (Math.abs(next.z - prevZ) > 1e-6) {
      setZoomLabel(`${next.z.toFixed(1)}×`);
      if (labelTimer.current) clearTimeout(labelTimer.current);
      labelTimer.current = setTimeout(() => setZoomLabel(null), 1000);
    }
  }, []);

  const rel = (e: React.PointerEvent): Vec2 => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const clearPress = () => { if (press.current) { clearTimeout(press.current); press.current = null; } };
  const endCompare = () => { if (comparing.current) { comparing.current = false; onCompare(false); } };

  const onDown = (e: React.PointerEvent) => {
    if (!geometry || disabled) return;
    if ((e.target as HTMLElement).closest("button,input")) return;
    box.current?.setPointerCapture(e.pointerId);
    const pt = rel(e);
    if (picking) { pickStart.current = { id: e.pointerId, ...pt }; return; }
    ptrs.current.set(e.pointerId, pt);
    if (ptrs.current.size === 1) {
      single.current = { x: pt.x, y: pt.y, moved: false };
      clearPress();
      press.current = setTimeout(() => {
        press.current = null;
        if (ptrs.current.size === 1 && single.current && !single.current.moved) { comparing.current = true; onCompare(true); }
      }, LONG_PRESS_MS);
    } else if (ptrs.current.size === 2) {
      clearPress();
      endCompare();
      const [a, b] = [...ptrs.current.values()] as [Vec2, Vec2];
      pinchStart.current = { z0: zoomRef.current.z, t0: zoomRef.current.t, mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (picking) return;
    if (!geometry || !ptrs.current.has(e.pointerId)) return;
    const pt = rel(e);
    const prev = ptrs.current.get(e.pointerId)!;
    ptrs.current.set(e.pointerId, pt);
    if (ptrs.current.size === 2 && pinchStart.current) {
      const [a, b] = [...ptrs.current.values()] as [Vec2, Vec2];
      commit(pinch(pinchStart.current, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, Math.hypot(a.x - b.x, a.y - b.y), geometry));
      return;
    }
    const s = single.current;
    if (ptrs.current.size === 1 && s) {
      if (!s.moved && Math.hypot(pt.x - s.x, pt.y - s.y) >= LONG_PRESS_SLOP) { s.moved = true; clearPress(); }
      if (comparing.current) return; // 원본 비교 중에는 팬을 하지 않는다
      if (s.moved) commit(pan(zoomRef.current, pt.x - prev.x, pt.y - prev.y, geometry));
    }
  };

  const onUp = (e: React.PointerEvent) => {
    const ps = pickStart.current;
    if (ps && ps.id === e.pointerId) {
      pickStart.current = null;
      const pt = rel(e);
      // 탭(이동 8px 미만)이고 취소가 아닐 때만 픽: 이미지 바깥 탭은 무시
      if (picking && geometry && e.type === "pointerup" && Math.hypot(pt.x - ps.x, pt.y - ps.y) < LONG_PRESS_SLOP) {
        const uv = pointToImageUV(pt, zoomRef.current, geometry);
        if (uv) onPick?.(uv.u, uv.v);
      }
      return;
    }
    if (!ptrs.current.has(e.pointerId)) return;
    const wasSingle = ptrs.current.size === 1;
    ptrs.current.delete(e.pointerId);
    clearPress();
    const s = single.current;
    if (wasSingle) {
      const wasCompare = comparing.current;
      endCompare();
      if (geometry && s && !s.moved && !wasCompare) {
        const cur = { time: e.timeStamp, x: s.x, y: s.y };
        if (fs.active && !pointToImageUV({ x: s.x, y: s.y }, zoomRef.current, geometry)) { lastTap.current = null; single.current = null; fs.close(); return; }
        if (isDoubleTap(lastTap.current, cur)) { lastTap.current = null; commit(doubleTapZoom(zoomRef.current, { x: s.x, y: s.y }, geometry)); }
        else lastTap.current = cur;
      }
      single.current = null;
    }
    if (ptrs.current.size < 2) pinchStart.current = null;
    if (ptrs.current.size === 1) {
      const [only] = [...ptrs.current.values()] as [Vec2];
      single.current = { x: only.x, y: only.y, moved: true };
    }
  };

  const canvasStyle: React.CSSProperties = fit
    ? { width: fit.bw, height: fit.bh, position: "absolute", left: (size.w - fit.bw) / 2, top: (size.h - fit.bh) / 2 }
    : { display: "none" };
  const isVideo = asset?.kind === "video";

  return (
    <div
      ref={box} className={fs.active ? "fixed inset-0 z-[60] overflow-hidden bg-black" : "relative min-h-[40dvh] flex-1 overflow-hidden bg-black"}
      style={{ touchAction: "none", cursor: picking ? "crosshair" : undefined, ...(fs.active ? { height: "100dvh" } : null) }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
    >
      <div className="absolute inset-0" style={{ transform: `translate(${zoom.t.x}px, ${zoom.t.y}px) scale(${zoom.z})`, transformOrigin: "50% 50%", willChange: "transform" }}>
        <canvas ref={canvasRef} style={canvasStyle} aria-label="미리보기" />
        {fit && pickMarker ? (
          <div
            key={pickMarker.key} aria-hidden className="pointer-events-none absolute rounded-full"
            style={{
              left: (size.w - fit.bw) / 2 + pickMarker.u * fit.bw - 18, top: (size.h - fit.bh) / 2 + pickMarker.v * fit.bh - 18, width: 36, height: 36,
              border: "2px solid #fff", boxShadow: "0 0 0 1.5px rgba(0,0,0,0.7), inset 0 0 0 1.5px rgba(0,0,0,0.7)", transform: `scale(${1 / zoom.z})`,
            }}
          />
        ) : null}
      </div>
      {asset && renderer && geometry ? <DetailOverlay renderer={renderer} asset={asset} zoom={zoom} geometry={geometry} editKey={editKey} /> : null}
      {asset && !fs.active ? <Histogram renderer={renderer} tick={editKey} playing={playing} active={!disabled} key={assetId ?? "none"} /> : null}
      {!fs.active ? <HdfToggle on={hdf} onToggle={onToggleHdf} disabled={!asset} /> : null}
      {!fs.active ? (
        <button
          type="button" aria-label="전체화면 보기" disabled={!asset || disabled || picking}
          className={`absolute right-[72px] top-0 z-10 flex h-[48px] w-[48px] items-center justify-center text-white ${!asset || disabled || picking ? "opacity-40" : ""}`}
          onClick={fs.open}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: "#2a2a2e" }}><IconFullscreen size={18} /></span>
        </button>
      ) : (
        <button
          type="button" aria-label="전체화면 닫기"
          className="absolute z-[70] flex h-[48px] w-[48px] items-center justify-center text-white"
          style={{ top: "max(8px, env(safe-area-inset-top))", right: "max(8px, env(safe-area-inset-right))" }}
          onClick={fs.close}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: "rgba(0,0,0,0.65)", border: "1px solid rgba(255,255,255,0.6)" }}><IconClose size={22} /></span>
        </button>
      )}
      {picking && !fs.active ? <div role="status" className="pointer-events-none absolute left-1/2 top-2 z-20 w-[calc(100%-24px)] max-w-[420px] -translate-x-1/2 rounded-[12px] px-3 py-2 text-center text-[12px] leading-snug text-white" style={{ background: "rgba(0,0,0,0.75)", border: "1px solid var(--accent)" }}>사진에서 기준이 될 흰색 또는 회색 영역을 터치하세요 (취소: 스포이트 다시 누르기)</div> : null}
      {compare ? <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full px-3 py-1 text-[12px] text-white" style={{ background: "rgba(0,0,0,0.6)" }}>원본</div> : null}
      {zoomLabel ? <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full px-3 py-1 text-[12px] text-white" style={{ background: "rgba(0,0,0,0.6)", bottom: isVideo ? 60 : 12 }}>{zoomLabel}</div> : null}
      {isVideo && renderer && asset?.video ? <VideoBar renderer={renderer} fps={asset.video.fps} onPlayingChange={setPlaying} pauseSignal={pauseVideoSignal} /> : null}
      {fs.active ? null : children}
    </div>
  );
}

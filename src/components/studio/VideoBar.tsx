"use client";
// Step 4 §8-7 동영상 컨트롤 (프리뷰 하단 오버레이 48px). 재생 루프는 Step 3 의 <video> + requestVideoFrameCallback 경로.
import { useEffect, useRef, useState } from "react";
import type { FilmRenderer } from "@/lib/render/renderer";
import { IconMute, IconPause, IconPlay, IconVolume } from "./icons";

const mmss = (t: number) => {
  if (!Number.isFinite(t) || t < 0) return "0:00";
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
};

export function VideoBar({ renderer, fps, onPlayingChange, pauseSignal }: { renderer: FilmRenderer; fps: number; onPlayingChange(p: boolean): void; pauseSignal: number }) {
  const [t, setT] = useState(0);
  const [d, setD] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const wasPlaying = useRef(false);
  const scrubbing = useRef(false);

  useEffect(() => {
    const v = renderer.video.element();
    if (!v) return;
    const sync = () => { setT(v.currentTime); setD(Number.isFinite(v.duration) ? v.duration : 0); setPlaying(!v.paused); onPlayingChange(!v.paused); };
    const events = ["timeupdate", "play", "pause", "ended", "loadedmetadata", "durationchange", "seeked"] as const;
    for (const e of events) v.addEventListener(e, sync);
    sync();
    return () => { for (const e of events) v.removeEventListener(e, sync); };
  }, [renderer, onPlayingChange]);

  // 저장 모달이 열리면 일시정지
  useEffect(() => { if (pauseSignal > 0) renderer.video.pause(); }, [pauseSignal, renderer]);

  const toggle = () => { if (playing) renderer.video.pause(); else void renderer.video.play().catch(() => undefined); };
  const toggleMute = () => { const v = renderer.video.element(); if (v) { v.muted = !v.muted; setMuted(v.muted); } };
  const step = fps > 0 ? 1 / fps : 0.01;

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 flex h-12 items-center gap-1 px-1" style={{ background: "rgba(0,0,0,0.45)" }}>
      <button type="button" aria-label={playing ? "일시정지" : "재생"} className="flex h-11 w-11 items-center justify-center text-white" onClick={toggle}>{playing ? <IconPause /> : <IconPlay />}</button>
      <span className="tnum w-10 text-center text-[12px] text-white">{mmss(t)}</span>
      <input
        type="range" aria-label="탐색" min={0} max={d || 0} step={step} value={Math.min(t, d || 0)} className="h-11 min-w-0 flex-1 accent-[#ff6a1a]" style={{ touchAction: "none" }}
        onPointerDown={() => { scrubbing.current = true; wasPlaying.current = playing; renderer.video.pause(); }}
        onChange={(e) => { setT(Number(e.target.value)); renderer.video.seek(Number(e.target.value)); }}
        onPointerUp={() => { scrubbing.current = false; if (wasPlaying.current) void renderer.video.play().catch(() => undefined); }}
        onPointerCancel={() => { scrubbing.current = false; }}
      />
      <span className="tnum w-10 text-center text-[12px] text-white">{mmss(d)}</span>
      <button type="button" aria-label={muted ? "음소거 해제" : "음소거"} className="flex h-11 w-11 items-center justify-center text-white" onClick={toggleMute}>{muted ? <IconMute /> : <IconVolume />}</button>
    </div>
  );
}

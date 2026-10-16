"use client";
// Step 4 §7-7 토스트: 탭 바 위 12px, 가로 가운데, 한 번에 1개(나머지는 큐), 기본 3초 / 액션이 있으면 5초.
import { useCallback, useEffect, useRef, useState } from "react";

export interface ToastAction { label: string; onClick(): void }
export interface ToastItem { id: number; message: string; actions?: ToastAction[]; duration?: number }
export type ToastFn = (message: string, opts?: { actions?: ToastAction[]; duration?: number }) => void;

export function useToastQueue(): { current: ToastItem | null; toast: ToastFn; dismiss(): void } {
  const [queue, setQueue] = useState<ToastItem[]>([]);
  const [current, setCurrent] = useState<ToastItem | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback<ToastFn>((message, opts) => {
    setQueue((q) => [...q, { id: ++seq.current, message, actions: opts?.actions, duration: opts?.duration }]);
  }, []);
  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setCurrent(null);
  }, []);

  useEffect(() => {
    if (current || queue.length === 0) return;
    const [next, ...rest] = queue;
    queueMicrotask(() => {
      setQueue(rest);
      setCurrent(next!);
    });
  }, [current, queue]);

  useEffect(() => {
    if (!current) return;
    const ms = current.duration ?? (current.actions && current.actions.length > 0 ? 5000 : 3000);
    timer.current = setTimeout(() => { timer.current = null; setCurrent(null); }, ms);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [current]);

  return { current, toast, dismiss };
}

export function ToastView({ item, onDismiss }: { item: ToastItem | null; onDismiss(): void }) {
  if (!item) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 z-50 flex justify-center px-4" style={{ bottom: "calc(env(safe-area-inset-bottom) + 56px + 12px)" }}>
      <div role="status" className="pointer-events-auto flex max-w-[calc(100%-32px)] items-center gap-3 rounded-[12px] bg-[#1c1c1f] px-4 py-2.5 text-[13px] text-[var(--text)] shadow-lg">
        <span className="min-w-0 break-words">{item.message}</span>
        {item.actions?.map((a) => (
          <button key={a.label} type="button" className="min-h-11 shrink-0 px-1 font-semibold text-[var(--accent)]" onClick={() => { a.onClick(); onDismiss(); }}>{a.label}</button>
        ))}
      </div>
    </div>
  );
}

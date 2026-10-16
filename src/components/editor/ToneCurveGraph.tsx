"use client";

import { useMemo, useRef } from "react";
import { bakeCurve, curvePoints, CURVE_MAX_POINTS, CURVE_MIN_GAP, LINEAR_CURVE, type CurvePoint, type CurveState } from "@/lib/render/curve";

/**
 * 섹션 14-6 터치 그래프 (256×256): 빈 곳 탭 = 점 추가(최대 12), 드래그 = 이동,
 * 길게 누르기 500ms = 삭제(끝점 제외), 더블탭 = 선형.
 */
export function ToneCurveGraph({ value, onChange, onDragStart, onCommit }: { value: CurveState; onChange(v: CurveState): void; onDragStart?(): void; onCommit?(): void }) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ idx: number; moved: boolean; x0: number; y0: number; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  const lastTap = useRef(0);
  const active = useRef(false);
  const pts = curvePoints(value);
  const path = useMemo(() => {
    const T = bakeCurve(value);
    let d = "";
    for (let i = 0; i < T.length; i++) d += `${i === 0 ? "M" : "L"}${i} ${(255 - T[i]! * 255).toFixed(2)}`;
    return d;
  }, [value]);

  const toUnit = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = svg.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))];
  };

  const setPoints = (p: CurvePoint[]) => onChange({ ...value, points: p });

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    svg.current?.setPointerCapture(e.pointerId);
    if (!active.current) { active.current = true; onDragStart?.(); }
    const [x, y] = toUnit(e);
    const now = e.timeStamp;
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      onChange({ ...LINEAR_CURVE, zones: value.zones });
      drag.current = null;
      return;
    }
    lastTap.current = now;
    const cur = pts.map((p) => [p[0], p[1]] as CurvePoint);
    let idx = -1, best = 0.06, added = false;
    cur.forEach((p, i) => { const d = Math.hypot(p[0] - x, p[1] - y); if (d < best) { best = d; idx = i; } });
    if (idx < 0) {
      if (cur.length >= CURVE_MAX_POINTS) return;
      const k = cur.findIndex((p) => p[0] > x);
      if (k <= 0) return;
      if (x - cur[k - 1]![0] < CURVE_MIN_GAP || cur[k]![0] - x < CURVE_MIN_GAP) return;
      cur.splice(k, 0, [x, y]);
      idx = k;
      added = true;
      setPoints(cur);
    }
    const timer = !added && idx > 0 && idx < cur.length - 1 ? setTimeout(() => {
      const d = drag.current;
      if (!d || d.moved) return;
      const next = curvePoints(value).map((p) => [p[0], p[1]] as CurvePoint);
      next.splice(d.idx, 1);
      setPoints(next);
      drag.current = null;
    }, 500) : null;
    drag.current = { idx, moved: false, x0: x, y0: y, timer };
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const [x, y] = toUnit(e);
    if (!d.moved && Math.hypot(x - d.x0, y - d.y0) < 0.01) return;
    d.moved = true;
    if (d.timer) { clearTimeout(d.timer); d.timer = null; }
    const cur = pts.map((p) => [p[0], p[1]] as CurvePoint);
    const last = cur.length - 1;
    const px = d.idx === 0 ? 0 : d.idx === last ? 1 : Math.min(cur[d.idx + 1]![0] - CURVE_MIN_GAP, Math.max(cur[d.idx - 1]![0] + CURVE_MIN_GAP, x));
    cur[d.idx] = [px, y];
    setPoints(cur);
  };

  const onUp = () => {
    const d = drag.current;
    if (d?.timer) clearTimeout(d.timer);
    drag.current = null;
    if (active.current) { active.current = false; onCommit?.(); }
  };

  return (
    <svg
      ref={svg} viewBox="0 0 255 255" className="aspect-square w-full max-w-[320px] touch-none select-none rounded-xl bg-neutral-950"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      role="img" aria-label="톤 커브 그래프"
    >
      {[64, 128, 191].map((g) => (
        <g key={g} stroke="#333" strokeWidth={0.6}>
          <line x1={g} y1={0} x2={g} y2={255} />
          <line x1={0} y1={g} x2={255} y2={g} />
        </g>
      ))}
      <line x1={0} y1={255} x2={255} y2={0} stroke="#444" strokeDasharray="3 3" strokeWidth={0.6} />
      <path d={path} fill="none" stroke="#fbbf24" strokeWidth={1.6} />
      {pts.map((p, i) => <circle key={i} cx={p[0] * 255} cy={255 - p[1] * 255} r={5} fill="#111" stroke="#fbbf24" strokeWidth={1.5} />)}
    </svg>
  );
}

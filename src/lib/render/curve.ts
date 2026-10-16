// 섹션 5.12 / COLOR_SCIENCE §8.7 — 톤 커브 프리셋·Fritsch–Carlson·5구간 슬라이더·단조 보정 → 256칸.
export type CurvePreset = "linear" | "weak-contrast" | "strong-contrast" | "matte" | "soft-highlight";
export type CurvePoint = [number, number];
export type Zones = [number, number, number, number, number];

export interface CurveState {
  preset: CurvePreset;
  /** 사용자 점(터치 그래프). null 이면 프리셋 제어점 사용 */
  points: CurvePoint[] | null;
  zones: Zones;
}

export const CURVE_PRESETS: Readonly<Record<CurvePreset, ReadonlyArray<CurvePoint>>> = Object.freeze({
  linear: [[0, 0], [1, 1]],
  "weak-contrast": [[0, 0], [0.25, 0.22], [0.5, 0.5], [0.75, 0.78], [1, 1]],
  "strong-contrast": [[0, 0], [0.25, 0.18], [0.5, 0.5], [0.75, 0.83], [1, 1]],
  matte: [[0, 0.08], [0.25, 0.28], [0.5, 0.52], [0.75, 0.76], [1, 0.96]],
  "soft-highlight": [[0, 0], [0.25, 0.25], [0.5, 0.52], [0.85, 0.82], [1, 0.94]],
});

export const CURVE_PRESET_LABEL: Readonly<Record<CurvePreset, string>> = {
  linear: "선형", "weak-contrast": "약한 대비", "strong-contrast": "강한 대비", matte: "매트", "soft-highlight": "소프트 하이라이트",
};

export const CURVE_N = 256;
export const CURVE_MAX_POINTS = 12;
export const CURVE_MIN_GAP = 0.02;
const ZONE_CENTERS = [0.1, 0.3, 0.5, 0.7, 0.9] as const;

export const LINEAR_CURVE: CurveState = { preset: "linear", points: null, zones: [0, 0, 0, 0, 0] };

/** 단조 3차 Hermite (Fritsch–Carlson 1980) */
export function monotoneHermite(pts: ReadonlyArray<CurvePoint>): (x: number) => number {
  const n = pts.length - 1;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d: number[] = [];
  for (let k = 0; k < n; k++) d.push((ys[k + 1]! - ys[k]!) / (xs[k + 1]! - xs[k]!));
  const m: number[] = new Array<number>(n + 1).fill(0);
  m[0] = d[0]!;
  m[n] = d[n - 1]!;
  for (let k = 1; k < n; k++) m[k] = d[k - 1]! * d[k]! <= 0 ? 0 : (d[k - 1]! + d[k]!) / 2;
  for (let k = 0; k < n; k++) {
    const dk = d[k]!;
    if (dk === 0) { m[k] = 0; m[k + 1] = 0; continue; }
    const a = m[k]! / dk, b = m[k + 1]! / dk;
    if (a * a + b * b > 9) {
      const t = 3 / Math.sqrt(a * a + b * b);
      m[k] = t * a * dk;
      m[k + 1] = t * b * dk;
    }
  }
  return (x: number) => {
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n]!) return ys[n]!;
    let k = 0;
    while (k < n - 1 && x > xs[k + 1]!) k++;
    const h = xs[k + 1]! - xs[k]!;
    const t = (x - xs[k]!) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[k]! + (t3 - 2 * t2 + t) * h * m[k]! + (-2 * t3 + 3 * t2) * ys[k + 1]! + (t3 - t2) * h * m[k + 1]!;
  };
}

export function curvePoints(s: CurveState): ReadonlyArray<CurvePoint> {
  return s.points ?? CURVE_PRESETS[s.preset];
}

/** F(x) = clamp(H(x) + Σ 0.10·(Z_k/100)·φ_k(x), 0, 1) */
export function curveF(s: CurveState): (x: number) => number {
  const H = monotoneHermite(curvePoints(s));
  return (x: number) => {
    let y = H(x);
    for (let k = 0; k < 5; k++) {
      const dd = x - ZONE_CENTERS[k]!;
      if (Math.abs(dd) <= 0.2) y += 0.1 * (s.zones[k]! / 100) * 0.5 * (1 + Math.cos((Math.PI * dd) / 0.2));
    }
    return Math.min(1, Math.max(0, y));
  };
}

/** 256칸 굽기: T[i] = F(i/255), 이어서 T[i] = max(T[i], T[i−1]) */
export function bakeCurve(s: CurveState): Float32Array {
  const F = curveF(s);
  const T = new Float32Array(CURVE_N);
  for (let i = 0; i < CURVE_N; i++) {
    let v = F(i / (CURVE_N - 1));
    if (i > 0) v = Math.max(v, T[i - 1]!);
    T[i] = v;
  }
  return T;
}

/** GPU texture(uCurve, ((v·255+0.5)/256, 0.5)) LINEAR 샘플과 같은 선형 보간 */
export function sampleCurve(T: ArrayLike<number>, v: number): number {
  const p = Math.min(1, Math.max(0, v)) * (CURVE_N - 1);
  const i = Math.min(Math.floor(p), CURVE_N - 2);
  const t = p - i;
  return T[i]! * (1 - t) + T[i + 1]! * t;
}

/** uCurveOn = !(프리셋 linear && 사용자 점 없음 && 5구간 전부 0) */
export function curveOn(s: CurveState): boolean {
  return !(s.preset === "linear" && s.points === null && s.zones.every((z) => z === 0));
}

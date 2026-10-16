// 단계 기록 버튼(타임라인) · 컬러 자동 보정 · WB 스포이트
import { describe, expect, it } from "vitest";
import { computeAutoColor, neutralError, PICK_RADIUS, sampleWindowMean, solveEyedropper, solveNeutralWb, uvToPixel, type RgbaGrid } from "../src/lib/studio/color-auto";
import { pointToImageUV } from "../src/lib/studio/gestures";
import { historyReducer, historyTimeline, initialHistory, redoLabel, undoLabel, type HistoryState } from "../src/lib/studio/history";
import { initialEditState } from "../src/lib/studio/state";
import { apply3, wbMatrix } from "../src/lib/render/wb";
import { TRADEMARK_DISCLAIMER } from "../src/components/studio/AboutSheet";
import { readFileSync } from "node:fs";

const base = () => initialHistory({ edit: initialEditState(), choice: "auto" });
const run = (h: HistoryState, ...actions: Parameters<typeof historyReducer>[1][]) => actions.reduce(historyReducer, h);

describe("단계 기록 타임라인 (별도 버튼이 여는 목록)", () => {
  it("단계가 쌓이면 초기 상태 ~ 최신 단계가 목록에 나오고 탭 한 번(jump)으로 이동한다", () => {
    let h = run(base(), { type: "do", action: { type: "set", key: "exposure", value: 1 } }, { type: "do", action: { type: "set", key: "contrast", value: 20 } });
    const tl = historyTimeline(h);
    expect(tl.map((e) => e.label)).toEqual(["초기 상태", "노출", "대비"]);
    expect(tl[2]!.kind).toBe("current");
    h = historyReducer(h, { type: "jump", index: 0 });
    expect(h.present.edit.exposure).toBe(0);
    expect(h.future).toHaveLength(2);
    h = historyReducer(h, { type: "jump", index: 2 });
    expect(h.present.edit.contrast).toBe(20);
  });

  it("초기값/직전 값과 같은 조작은 단계로 쌓이지 않는다", () => {
    let h = run(base(), { type: "do", action: { type: "set", key: "exposure", value: 0 } });
    expect(h.past).toHaveLength(0);
    h = run(h, { type: "do", action: { type: "set", key: "exposure", value: 1 } }, { type: "do", action: { type: "set", key: "exposure", value: 1 } });
    expect(h.past).toHaveLength(1);
    const wb = run(base(), { type: "do", label: "WB 스포이트", action: { type: "patch", values: { temp: 0, tint: 0 } } });
    expect(wb.past).toHaveLength(0);
  });

  it("명시적 라벨은 타임라인·되돌리기·다시 실행 문구에 쓰이고, 이후 라이브 편집에는 남지 않는다", () => {
    let h = run(base(), { type: "do", label: "컬러 자동 보정", action: { type: "patch", values: { temp: 10, tint: -5, vibrance: 20, saturation: 3 } } });
    expect(undoLabel(h)).toBe("컬러 자동 보정");
    expect(historyTimeline(h).map((e) => e.label)).toEqual(["초기 상태", "컬러 자동 보정"]);
    h = historyReducer(h, { type: "undo" });
    expect(redoLabel(h)).toBe("컬러 자동 보정");
    h = historyReducer(h, { type: "redo" });
    h = run(h, { type: "begin" }, { type: "live", action: { type: "set", key: "temp", value: 30 } }, { type: "commit" });
    expect(undoLabel(h)).toBe("색온도");
  });
});

/** 균일한 RGBA 격자 */
const grid = (w: number, h: number, f: (x: number, y: number) => [number, number, number]): RgbaGrid => {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = f(x, y); data.set([r, g, b, 1], (y * w + x) * 4); }
  return { width: w, height: h, data };
};
/** 중성 회색 s 를 (temp, tint) 로 만든 광원 아래에서 본 색: WB 역행렬이 아니라 WB 가 이 색을 중성으로 되돌린다 */
const castBy = (t: number, k: number, gray: number): [number, number, number] => {
  const m = wbMatrix(t, k);
  const inv = invert(m);
  return apply3(inv, [gray, gray, gray]);
};
function invert(m: number[][]): [[number, number, number], [number, number, number], [number, number, number]] {
  const [[a, b, c], [d, e, f], [g, h, i]] = m as [[number, number, number], [number, number, number], [number, number, number]];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
}

describe("WB 스포이트: 좌표 변환과 5×5 샘플링", () => {
  it("pointToImageUV: 줌/팬을 반영하고 이미지 바깥은 null", () => {
    const g = { Wc: 400, Hc: 300, bw: 400, bh: 200 };
    expect(pointToImageUV({ x: 200, y: 150 }, { z: 1, t: { x: 0, y: 0 } }, g)).toEqual({ u: 0.5, v: 0.5 });
    expect(pointToImageUV({ x: 200, y: 10 }, { z: 1, t: { x: 0, y: 0 } }, g)).toBeNull();
    const z = pointToImageUV({ x: 300, y: 150 }, { z: 2, t: { x: 100, y: 0 } }, g)!;
    expect(z.u).toBeCloseTo(0.5, 9);
  });

  it("uvToPixel 는 경계를 격자 안으로 clamp 한다", () => {
    expect(uvToPixel(1, 1, 10, 8)).toEqual({ x: 9, y: 7 });
    expect(uvToPixel(0, 0, 10, 8)).toEqual({ x: 0, y: 0 });
  });

  it("5×5 평균: 단일 픽셀 노이즈에 흔들리지 않고, 가장자리에서는 창을 잘라낸다", () => {
    const g = grid(21, 21, (x, y) => (x === 10 && y === 10 ? [1, 0, 0] : [0.2, 0.2, 0.2]));
    const m = sampleWindowMean(g, 10.5 / 21, 10.5 / 21)!;
    expect(PICK_RADIUS).toBe(2);
    expect(m[0]).toBeCloseTo((24 * 0.2 + 1) / 25, 6);
    expect(m[1]).toBeCloseTo((24 * 0.2) / 25, 6);
    const corner = grid(10, 10, () => [0.3, 0.4, 0.5]);
    expect(sampleWindowMean(corner, 0, 0)).toEqual([expect.closeTo(0.3, 6), expect.closeTo(0.4, 6), expect.closeTo(0.5, 6)]);
  });

  it("역산: 따뜻한/차가운/초록/마젠타 캐스트 회색을 R=G=B 로 되돌린다", () => {
    for (const [t, k] of [[40, 0], [-50, 0], [0, 30], [0, -30], [30, 20], [-35, -15]] as const) {
      const rgb = castBy(t, k, 0.4);
      const sol = solveNeutralWb(rgb)!;
      expect(neutralError(apply3(wbMatrix(sol.temp, sol.tint), rgb))).toBeLessThan(2e-4);
      expect(Math.abs(sol.temp - t)).toBeLessThanOrEqual(2);
      expect(Math.abs(sol.tint - k)).toBeLessThanOrEqual(2);
    }
  });

  it("이미 중성이면 0/0, 정수·범위 [-100,100], 검정은 null", () => {
    const n = solveNeutralWb([0.5, 0.5, 0.5])!;
    expect(n.temp).toBe(0);
    expect(n.tint).toBe(0);
    const ext = solveNeutralWb([0.05, 0.3, 0.9])!;
    expect(Number.isInteger(ext.temp) && Number.isInteger(ext.tint)).toBe(true);
    expect(Math.abs(ext.temp)).toBeLessThanOrEqual(100);
    expect(Math.abs(ext.tint)).toBeLessThanOrEqual(100);
    expect(solveNeutralWb([0, 0, 0])).toBeNull();
  });

  it("solveEyedropper: 탭한 회색 영역의 캐스트를 슬라이더 값으로 돌려준다", () => {
    const cast = castBy(35, -10, 0.35);
    const g = grid(40, 40, (x) => (x < 20 ? cast : [0.8, 0.1, 0.1]));
    const r = solveEyedropper(g, 0.25, 0.5)!;
    expect(Math.abs(r.temp - 35)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.tint + 10)).toBeLessThanOrEqual(2);
    expect(solveEyedropper(grid(10, 10, () => [0, 0, 0]), 0.5, 0.5)).toBeNull();
  });
});

describe("컬러 자동 보정 ACA-v1", () => {
  it("전체에 색 캐스트가 낀 장면(푸른기)을 색온도 +40 으로 중화한다", () => {
    const cool = castBy(40, 0, 0.3);
    const g = grid(32, 32, (x, y) => { const k = 0.15 + 0.6 * ((x + y) / 62); const c = castBy(40, 0, k); return [c[0], c[1], c[2]]; });
    const r = computeAutoColor(g)!;
    expect(cool[2]).toBeGreaterThan(cool[0]); // 푸른 캐스트 → 따뜻하게(+) 보정
    expect(Math.abs(r.temp - 40)).toBeLessThanOrEqual(3);
    expect(Math.abs(r.tint)).toBeLessThanOrEqual(3);
  });

  it("순백/순흑(클리핑)은 광원 추정에서 제외된다", () => {
    const cast = castBy(-30, 10, 0.3);
    const g = grid(40, 40, (x) => (x < 12 ? [1, 1, 1] : x < 20 ? [0, 0, 0] : cast));
    const r = computeAutoColor(g)!;
    expect(Math.abs(r.temp + 30)).toBeLessThanOrEqual(3);
    expect(Math.abs(r.tint - 10)).toBeLessThanOrEqual(3);
  });

  it("유효 픽셀이 부족하면 null (전부 순백)", () => {
    expect(computeAutoColor(grid(8, 8, () => [1, 1, 1]))).toBeNull();
    expect(computeAutoColor({ width: 0, height: 0, data: [] })).toBeNull();
  });

  it("무채색 사진은 생동감을 크게, 이미 채도가 높은 사진은 낮게/음수로 잡는다. 범위 준수", () => {
    const flat = computeAutoColor(grid(16, 16, (x) => { const k = 0.1 + 0.02 * x; return [k, k, k]; }))!;
    expect(flat.temp).toBe(0);
    expect(flat.vibrance).toBe(60);
    expect(flat.saturation).toBe(15);
    const vivid = computeAutoColor(grid(16, 16, (x) => (x % 2 ? [0.7, 0.05, 0.05] : [0.05, 0.05, 0.7])))!;
    expect(vivid.vibrance).toBeLessThan(flat.vibrance);
    expect(vivid.vibrance).toBeGreaterThanOrEqual(-20);
    expect(vivid.saturation).toBeGreaterThanOrEqual(-10);
  });

  it("결정론: 같은 입력은 같은 결과", () => {
    const g = grid(20, 20, (x, y) => castBy(20, 5, 0.1 + (x + y) / 80));
    expect(computeAutoColor(g)).toEqual(computeAutoColor(g));
  });

  it("피부톤이 많으면 채도 증가를 억제한다", () => {
    const skin: [number, number, number] = [0.45, 0.25, 0.17];
    const g = grid(16, 16, () => skin);
    const gray = grid(16, 16, () => [0.3, 0.3, 0.3]);
    const a = computeAutoColor(g)!, b = computeAutoColor(gray)!;
    expect(a.saturation).toBeLessThan(b.saturation);
  });
});

describe("상표 면책 고지", () => {
  it("요청한 취지의 문구를 포함한다", () => {
    expect(TRADEMARK_DISCLAIMER).toContain("Fujifilm Corporation 및 Ricoh Company, Ltd.와 제휴, 보증 또는 후원 관계가 없습니다");
    expect(TRADEMARK_DISCLAIMER).toContain("각 소유자의 상표");
  });
  it("헤더에서 길게 누르기 트리거가 제거되고 별도 단계 기록 버튼이 있다", () => {
    const src = readFileSync("src/components/studio/Header.tsx", "utf8");
    expect(src).not.toMatch(/LONG_PRESS|onPointerDown|startPress/);
    expect(src).toContain("단계 기록 보기");
  });
});

import { describe, expect, it } from "vitest";
import { applyOrientation, displayRectToSource, orientedSize } from "../src/lib/media/orientation";
import { mulberry32 } from "./helpers/fixture";

const W = 3, H = 2;
const src = Int32Array.from({ length: 6 }, (_, i) => i);
const EXPECT: Record<number, number[]> = {
  1: [0, 1, 2, 3, 4, 5], 2: [2, 1, 0, 5, 4, 3], 3: [5, 4, 3, 2, 1, 0], 4: [3, 4, 5, 0, 1, 2],
  5: [0, 3, 1, 4, 2, 5], 6: [3, 0, 4, 1, 5, 2], 7: [5, 2, 4, 1, 3, 0], 8: [2, 5, 1, 4, 0, 3],
};

describe("방향 매핑 10.2", () => {
  for (let o = 1; o <= 8; o++) {
    it(`방향 ${o}`, () => {
      const r = applyOrientation(src, W, H, o, 1, (n) => new Int32Array(n));
      expect(Array.from(r.data)).toEqual(EXPECT[o]);
      expect({ w: r.width, h: r.height }).toEqual({ w: orientedSize(o, W, H).width, h: orientedSize(o, W, H).height });
    });
  }
  it("rect 역매핑: 원본 rect 를 잘라 정방향 변환 = 출력에서 직접 자른 결과", () => {
    const rnd = mulberry32(7);
    const SW = 9, SH = 6;
    const big = Int32Array.from({ length: SW * SH }, (_, i) => i);
    for (let o = 1; o <= 8; o++) {
      const full = applyOrientation(big, SW, SH, o, 1, (n) => new Int32Array(n));
      for (let k = 0; k < 20; k++) {
        const x = Math.floor(rnd() * full.width), y = Math.floor(rnd() * full.height);
        const w = 1 + Math.floor(rnd() * (full.width - x)), h = 1 + Math.floor(rnd() * (full.height - y));
        const direct: number[] = [];
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) direct.push(full.data[yy * full.width + xx]!);
        const s = displayRectToSource(o, SW, SH, { x, y, width: w, height: h });
        const crop = new Int32Array(s.width * s.height);
        for (let yy = 0; yy < s.height; yy++) for (let xx = 0; xx < s.width; xx++) crop[yy * s.width + xx] = big[(s.y + yy) * SW + s.x + xx]!;
        const t = applyOrientation(crop, s.width, s.height, o, 1, (n) => new Int32Array(n));
        expect(t.width).toBe(w);
        expect(t.height).toBe(h);
        expect(Array.from(t.data)).toEqual(direct);
      }
    }
  });
});

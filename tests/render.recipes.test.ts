import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { RECIPES, acrosGrain } from "../src/lib/render/recipes";
import { effectiveParams, DEFAULT_PARAMS } from "../src/lib/render/params";

const manifest = JSON.parse(readFileSync(new URL("../public/luts/manifest.json", import.meta.url), "utf8")) as { sims: Array<{ id: string; mono: boolean }> };

describe("섹션 15.2-4 원터치 마스터 레시피", () => {
  it("id 집합 = manifest 32 + none", () => {
    const ids = new Set(manifest.sims.map((s) => s.id));
    expect(ids.size).toBe(32);
    ids.add("none");
    expect(new Set(Object.keys(RECIPES))).toEqual(ids);
    expect(Object.keys(RECIPES).length).toBe(33);
  });
  it("acros-iso", () => {
    expect(acrosGrain(160)).toEqual({ amount: 0, size: 25 });
    expect(acrosGrain(800)).toEqual({ amount: 19, size: 25 });
    expect(acrosGrain(3200)).toEqual({ amount: 35, size: 60 });
    expect(acrosGrain(12800)).toEqual({ amount: 45, size: 60 });
    expect(acrosGrain(null)).toEqual({ amount: 3, size: 25 });
  });
  it("FSE-v2: 모든 레시피는 중립 (LUT 위 이중 적용 금지)", () => {
    for (const [id, rc] of Object.entries(RECIPES)) {
      expect([id, rc.sharpen, rc.clarity, rc.highlights, rc.shadows, rc.vignette, rc.grain, rc.cce, rc.fxb, rc.hdf]).toEqual([id, 0, 0, 0, 0, 0, { amount: 0, size: 0 }, 0, 0, false]);
    }
  });
  it("실효값: 사용자 값 그대로 clamp, 흑백 cce·fxb 0", () => {
    const e = effectiveParams({ ...DEFAULT_PARAMS, sim: "ricoh-hdr-tone", adjust: { ...DEFAULT_PARAMS.adjust, highlights: -80, clarity: 10 }, cce: 2 }, false);
    expect(e.adjust.highlights).toBe(-80);
    expect(e.adjust.clarity).toBe(10);
    expect(e.adjust.shadows).toBe(0);
    expect(e.adjust.sharpen).toBe(0);
    expect(e.cce).toBe(2);
    const m = effectiveParams({ ...DEFAULT_PARAMS, sim: "ricoh-hi-contrast-bw", cce: 2, fxb: 1 }, true);
    expect([m.cce, m.fxb]).toEqual([0, 0]);
    expect([m.adjust.grainAmount, m.adjust.grainSize, m.adjust.vignette]).toEqual([0, 0, 0]);
    const u = effectiveParams({ ...DEFAULT_PARAMS, sim: "ricoh-hi-contrast-bw", adjust: { ...DEFAULT_PARAMS.adjust, grainSize: 10 } }, true);
    expect(u.adjust.grainSize).toBe(10);
  });
});

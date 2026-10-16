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
  it("실효값: 사용자 + 레시피 clamp, 흑백 cce·fxb 0", () => {
    const e = effectiveParams({ ...DEFAULT_PARAMS, sim: "ricoh-hdr-tone", adjust: { ...DEFAULT_PARAMS.adjust, highlights: -80, clarity: 10 }, cce: 2 }, false);
    expect(e.adjust.highlights).toBe(-100);
    expect(e.adjust.clarity).toBe(80);
    expect(e.adjust.shadows).toBe(40);
    expect(e.adjust.sharpen).toBe(50);
    expect(e.cce).toBe(2);
    const m = effectiveParams({ ...DEFAULT_PARAMS, sim: "ricoh-hi-contrast-bw", cce: 2, fxb: 1 }, true);
    expect([m.cce, m.fxb]).toEqual([0, 0]);
    expect([m.adjust.grainAmount, m.adjust.grainSize, m.adjust.vignette]).toEqual([55, 45, -45]);
    const u = effectiveParams({ ...DEFAULT_PARAMS, sim: "ricoh-hi-contrast-bw", adjust: { ...DEFAULT_PARAMS.adjust, grainSize: 10 } }, true);
    expect(u.adjust.grainSize).toBe(10);
  });
});

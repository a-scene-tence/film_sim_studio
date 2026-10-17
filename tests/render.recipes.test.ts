import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { acrosGrain, FILM_PRESETS, NEUTRAL_PRESET, PRESET_KEYS } from "../src/lib/render/recipes";
import { effectiveParams, DEFAULT_PARAMS } from "../src/lib/render/params";

const manifest = JSON.parse(readFileSync(new URL("../public/luts/manifest.json", import.meta.url), "utf8")) as { sims: Array<{ id: string; mono: boolean }> };

describe("render/recipes (FSE-v2: 숨은 레시피 레이어 삭제, 프리셋 re-export)", () => {
  it("FILM_PRESETS id 집합 = manifest 32", () => {
    expect(new Set(Object.keys(FILM_PRESETS))).toEqual(new Set(manifest.sims.map((s) => s.id)));
    expect(PRESET_KEYS).toHaveLength(24);
    expect(NEUTRAL_PRESET.dRange).toBe(100);
  });
  it("acros-iso", () => {
    expect(acrosGrain(160)).toEqual({ amount: 0, size: 25 });
    expect(acrosGrain(800)).toEqual({ amount: 19, size: 25 });
    expect(acrosGrain(3200)).toEqual({ amount: 35, size: 60 });
    expect(acrosGrain(12800)).toEqual({ amount: 45, size: 60 });
    expect(acrosGrain(null)).toEqual({ amount: 3, size: 25 });
  });
  it("실효값: 사용자 값 그대로 clamp, 'recipe' = 0/끔, 흑백 cce·fxb 0", () => {
    const e = effectiveParams({ ...DEFAULT_PARAMS, sim: "ricoh-hdr-tone", adjust: { ...DEFAULT_PARAMS.adjust, highlights: -80, clarity: 10 }, cce: 2 }, false);
    expect(e.adjust.highlights).toBe(-80);
    expect(e.adjust.clarity).toBe(10);
    expect(e.adjust.shadows).toBe(0);
    expect(e.adjust.sharpen).toBe(0);
    expect(e.cce).toBe(2);
    expect(e.hdf).toBe(false);
    const m = effectiveParams({ ...DEFAULT_PARAMS, sim: "ricoh-hi-contrast-bw", cce: 2, fxb: 1 }, true);
    expect([m.cce, m.fxb]).toEqual([0, 0]);
    expect([m.adjust.grainAmount, m.adjust.grainSize, m.adjust.vignette]).toEqual([0, 0, 0]);
    const c = effectiveParams({ ...DEFAULT_PARAMS, adjust: { ...DEFAULT_PARAMS.adjust, clarity: 400 } }, false);
    expect(c.adjust.clarity).toBe(100);
  });
});

// Step 4 §6~§9 스튜디오 순수 로직 — T8 T9 T10 T11 T12 T13 T23.
import { describe, expect, it } from "vitest";
import { computeAutoLight } from "../src/lib/studio/auto-light";
import { binPixels, clipFlags, histHeights } from "../src/lib/studio/histogram";
import { clampPan, doubleTapZoom, pan, pinch, visibleRegion, type Geometry } from "../src/lib/studio/gestures";
import { buildExifCard, formatAperture, formatBody, formatFocalLength, formatShutterSpeed } from "../src/lib/studio/exif-format";
import {
  applyRecipe, defaultRecipeName, exportFileName, exportRecipes, importRecipes, loadRecipes, recipeFromState, RECIPES_CORRUPT_KEY, RECIPES_KEY, saveRecipes,
  validateRecipe, MAX_RECIPES, type Recipe, type StorageLike,
} from "../src/lib/studio/recipes";
import {
  defaultFor, editReducer, formatValue, initialEditState, normalizeValue, selectFilm, SLIDER_BY_KEY, SLIDERS, toCurveState, fromCurveState, type EditState, type SliderKey,
} from "../src/lib/studio/state";
import { buildUniforms } from "../src/lib/studio/uniforms";
import { CURVE_PRESETS } from "../src/lib/render/curve";

const close = (a: ArrayLike<number>, b: number[], tol: number) => b.forEach((v, i) => expect(Math.abs(a[i]! - v)).toBeLessThan(tol));

describe("T8 SLIDERS 표 · normalizeValue · buildUniforms", () => {
  const T: Record<string, [number, number, number, number]> = {
    filmStrength: [0, 100, 1, 100], lightBalance: [-100, 100, 1, 0], exposure: [-5, 5, 0.05, 0], brightness: [-100, 100, 1, 0], contrast: [-100, 100, 1, 0],
    highlights: [-100, 100, 1, 0], shadows: [-100, 100, 1, 0], whites: [-100, 100, 1, 0], blacks: [-100, 100, 1, 0], temp: [-100, 100, 1, 0], tint: [-100, 100, 1, 0],
    saturation: [-100, 100, 1, 0], vibrance: [-100, 100, 1, 0], cce: [0, 2, 1, 0], ccb: [0, 2, 1, 0], monoHue: [0, 359, 1, 0], monoAmount: [0, 100, 1, 0],
    sharpness: [0, 150, 1, 0], clarity: [-100, 100, 1, 0], dehaze: [-100, 100, 1, 0], hdfStrength: [0, 200, 1, 100], grainAmount: [0, 100, 1, 0], grainSize: [0, 100, 1, 0],
    vignette: [-100, 100, 1, 0], zone0: [-100, 100, 1, 0], zone1: [-100, 100, 1, 0], zone2: [-100, 100, 1, 0], zone3: [-100, 100, 1, 0], zone4: [-100, 100, 1, 0],
  };
  it("키 29개와 min/max/step/기본값", () => {
    expect(SLIDERS.length).toBe(29);
    for (const [k, [min, max, step, def]] of Object.entries(T)) {
      const s = SLIDER_BY_KEY[k as SliderKey];
      expect([s.min, s.max, s.step, s.def]).toEqual([min, max, step, def]);
    }
  });
  it("normalizeValue 경계값", () => {
    expect(normalizeValue("exposure", 7.123)).toBe(5);
    expect(normalizeValue("exposure", 0.123)).toBe(0.1);
    expect(normalizeValue("exposure", -0.001)).toBe(0);
    expect(Object.is(normalizeValue("exposure", -0.001), -0)).toBe(false);
    expect(normalizeValue("contrast", 55.6)).toBe(56);
    expect(normalizeValue("hdfStrength", -5)).toBe(0);
    expect(normalizeValue("filmStrength", 150)).toBe(100);
    expect(normalizeValue("cce", 3)).toBe(2);
    expect(normalizeValue("cce", "a")).toBe(0);
    expect(normalizeValue("filmStrength", NaN)).toBe(100);
    expect(normalizeValue("hdfStrength", undefined)).toBe(100);
  });
  it("표시 문자열", () => {
    expect(formatValue("filmStrength", 100)).toBe("100%");
    expect(formatValue("lightBalance", 12)).toBe("+12");
    expect(formatValue("lightBalance", -8)).toBe("−8");
    expect(formatValue("lightBalance", 0)).toBe("0");
    expect(formatValue("exposure", 0.35)).toBe("+0.35 EV");
    expect(formatValue("exposure", -1)).toBe("−1.00 EV");
    expect(formatValue("cce", 1)).toBe("약");
    expect(formatValue("monoHue", 40)).toBe("40°");
  });
  it("buildUniforms 매핑", () => {
    let st: EditState = initialEditState();
    st = { ...st, simId: "fuji-acros", filmStrength: 50, hdfStrength: 150, lightBalance: 20, contrast: -35, cce: 2, ccb: 1, monoHue: 70, monoAmount: 50 };
    const u = buildUniforms(st, true);
    expect(u.uFilmStrength).toBe(0.5);
    expect(u.uHdfK).toBe(1.5);
    expect(u.uLb).toBeCloseTo(0.2, 12);
    expect(u.uCt).toBeCloseTo(-0.35, 12);
    close(u.uMonoTint, [0.010261, 0.028191], 1e-6);
    // mono 필름이면 CCE/FX Blue 는 0 (Step 3 규칙) — mono 가 아니면 0.20 / 0.12
    const c = buildUniforms({ ...st, simId: "fuji-provia" }, false);
    expect([c.uKe, c.uKb]).toEqual([0.2, 0.12]);
    expect(c.uMonoTint).toEqual([0, 0]);
    expect([u.uKe, u.uKb]).toEqual([0, 0]);
  });
});

describe("T9 selectFilm / defaultFor (필름 선택은 simId 만 교체, 상세는 tests/fse2.presets.test.ts)", () => {
  it("필름 선택은 simId 외 모든 값을 유지한다", () => {
    const st = { ...initialEditState(), filmStrength: 40, monoHue: 30, contrast: 12, sharpness: 9 };
    const n = selectFilm(st, "fuji-velvia");
    expect([n.filmStrength, n.monoHue, n.simId, n.contrast, n.sharpness]).toEqual([40, 30, "fuji-velvia", 12, 9]);
    expect(selectFilm(n, null).sharpness).toBe(9);
  });
  it("defaultFor: 필름과 무관하게 §6-2 표 기본값 (필름 강도 100, 나머지 0)", () => {
    expect(defaultFor("sharpness")).toBe(0);
    expect(defaultFor("filmStrength")).toBe(100);
    expect(defaultFor("hdfStrength")).toBe(100);
    expect(defaultFor("zone2")).toBe(0);
    expect(defaultFor("grainAmount")).toBe(0);
    expect(defaultFor("clarity")).toBe(0);
  });
  it("커브: 프리셋 판별과 CurveState 왕복", () => {
    const c = editReducer(initialEditState(), { type: "curvePreset", preset: "matte" }).curve;
    expect(c.preset).toBe("matte");
    expect(toCurveState(c)).toEqual({ preset: "matte", points: null, zones: [0, 0, 0, 0, 0] });
    const custom = { ...c, points: [[0, 0], [0.4, 0.5], [1, 1]] as [number, number][] };
    expect(toCurveState(custom).points).not.toBeNull();
    expect(fromCurveState(toCurveState(custom)).preset).toBe("custom");
  });
});

describe("T10 레시피", () => {
  const base = {
    v: 1, id: "abc", name: "  테스트  ", createdAt: "2026-01-01T00:00:00.000Z", simId: "fuji-provia", filmStrength: 150,
    params: { exposure: 7.123, contrast: 55.6, hdfStrength: -5, cce: 3 },
    toneCurve: { preset: "zzz", points: [[0.5, 0.6], [0, 0.1], [0.505, 0.7], [1.2, 1]], zones: [1.4, 200, "a", 0, 0] }, toggles: { hdf: "yes" },
  };
  it("검증 골든", () => {
    const r = validateRecipe(base)!;
    expect(r.params.exposure).toBe(5);
    expect(validateRecipe({ ...base, params: { exposure: 0.123 } })!.params.exposure).toBe(0.1);
    expect(r.params.contrast).toBe(56);
    expect(r.params.hdfStrength).toBe(0);
    expect(r.filmStrength).toBe(100);
    expect(r.params.cce).toBe(2);
    expect(r.toneCurve.points).toEqual([[0, 0.1], [0.5, 0.6], [1, 1]]);
    expect(r.toneCurve.preset).toBe("custom");
    expect(r.toneCurve.zones).toEqual([0, 0, 0, 0, 0]);
    expect(r.toggles.hdf).toBe(false);
    expect(r.name).toBe("테스트");
  });
  it("거부 조건", () => {
    expect(validateRecipe(null)).toBeNull();
    expect(validateRecipe({ ...base, v: 2 })).toBeNull();
    expect(validateRecipe({ ...base, name: "   " })).toBeNull();
    expect(validateRecipe({ ...base, name: "가".repeat(41) })).toBeNull();
    expect(validateRecipe({ ...base, name: "가".repeat(40) })).not.toBeNull();
    expect(validateRecipe({ ...base, simId: "nope" })).toBeNull();
    expect(validateRecipe({ ...base, simId: null })!.simId).toBeNull();
  });
  it("id 규칙, createdAt, 점 개수", () => {
    expect(validateRecipe({ ...base, id: "bad id!" })!.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(validateRecipe({ ...base, id: "ok_id-1" })!.id).toBe("ok_id-1");
    expect(Number.isNaN(Date.parse(validateRecipe({ ...base, createdAt: "x" })!.createdAt))).toBe(false);
    const nine = Array.from({ length: 9 }, (_, i) => [i / 8, i / 8]);
    expect(validateRecipe({ ...base, toneCurve: { points: nine, zones: [0, 0, 0, 0, 0] } })!.toneCurve.points).toEqual([[0, 0], [1, 1]]);
    expect(validateRecipe({ ...base, toneCurve: { preset: "matte", points: CURVE_PRESETS.matte, zones: [0, 0, 0, 0, 0] } })!.toneCurve.preset).toBe("matte");
  });
  const mem = (): StorageLike & { m: Map<string, string> } => {
    const m = new Map<string, string>();
    return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
  };
  it("보내기 → 가져오기 왕복 동일성", () => {
    let st: EditState = selectFilm(initialEditState(), "ricoh-hdr-tone");
    st = { ...st, exposure: 0.35, saturation: -12, hdf: true, filmStrength: 80 };
    st = editReducer(st, { type: "curvePreset", preset: "strong-contrast" });
    const r = recipeFromState(st, "내 레시피", new Date("2026-10-16T06:39:00Z"));
    const text = exportRecipes([r]);
    expect(JSON.parse(text).format).toBe("filmlab-recipes");
    const imp = importRecipes(text, [])!;
    expect(imp.imported).toBe(1);
    expect(imp.recipes[0]).toEqual(r);
    expect(applyRecipe(initialEditState(), imp.recipes[0]!)).toEqual(st);
  });
  it("id 충돌 시 새 id, 형식 오류는 null, 건너뜀 집계", () => {
    const r = recipeFromState(initialEditState(), "A");
    const text = JSON.stringify({ format: "filmlab-recipes", v: 1, recipes: [r, { ...r, name: "" }] });
    const imp = importRecipes(text, [r])!;
    expect(imp.recipes.length).toBe(2);
    expect(imp.recipes[1]!.id).not.toBe(r.id);
    expect([imp.imported, imp.skipped]).toEqual([1, 1]);
    expect(importRecipes("{", [])).toBeNull();
    expect(importRecipes(JSON.stringify({ format: "x", v: 1, recipes: [] }), [])).toBeNull();
  });
  it("200개 상한", () => {
    const list: Recipe[] = Array.from({ length: MAX_RECIPES }, (_, i) => ({ ...recipeFromState(initialEditState(), `n${i}`), id: `id${i}` }));
    const imp = importRecipes(exportRecipes([recipeFromState(initialEditState(), "x")]), list)!;
    expect([imp.recipes.length, imp.imported, imp.skipped]).toEqual([200, 0, 1]);
  });
  it("손상 JSON 은 .corrupt 로 한 번 백업하고 빈 배열", () => {
    const s = mem();
    s.setItem(RECIPES_KEY, "{broken");
    expect(loadRecipes(s)).toEqual([]);
    expect(s.getItem(RECIPES_CORRUPT_KEY)).toBe("{broken");
    s.setItem(RECIPES_KEY, "{broken2");
    loadRecipes(s);
    expect(s.getItem(RECIPES_CORRUPT_KEY)).toBe("{broken");
    const r = recipeFromState(initialEditState(), "ok");
    const s2 = mem();
    expect(saveRecipes(s2, [r])).toBe(true);
    expect(loadRecipes(s2)).toEqual([r]);
  });
  it("기본 이름과 내보내기 파일명", () => {
    const d = new Date(2026, 9, 16, 6, 39, 5);
    expect(defaultRecipeName("프로비아", d)).toBe("프로비아 10-16 06:39");
    expect(defaultRecipeName(null, d)).toBe("필름 없음 10-16 06:39");
    expect(exportFileName(d)).toBe("filmlab-recipes-20261016.json");
  });
});

describe("T11 FLA-v1 자동 보정", () => {
  const ramp = (a: number, e: number) => Float64Array.from({ length: 1000 }, (_, i) => a * 2 ** ((e * i) / 999));
  it("A", () => expect(computeAutoLight(ramp(0.02, 8))).toEqual({ exposure: -0.65, contrast: -3, highlights: -60, shadows: 0, whites: -30, blacks: -30, brightness: 0, lightBalance: 0 }));
  it("B", () => expect(computeAutoLight(ramp(0.002, 4))).toEqual({ exposure: 3, contrast: 25, highlights: 0, shadows: 0, whites: 30, blacks: -30, brightness: 0, lightBalance: 0 }));
  it("C", () => expect(computeAutoLight(ramp(0.05, 3))).toEqual({ exposure: 0.3, contrast: 25, highlights: 0, shadows: 0, whites: 30, blacks: -30, brightness: 0, lightBalance: 0 }));
  it("빈 배열과 비유한 값", () => {
    expect(computeAutoLight([])).toEqual({ exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, brightness: 0, lightBalance: 0 });
    expect(computeAutoLight([NaN, Infinity])).toEqual(computeAutoLight([]));
    for (const v of Object.values(computeAutoLight([0, 0, 0]))) expect(Object.is(v, -0)).toBe(false);
  });
});

describe("T12 히스토그램", () => {
  it("빈 골든", () => {
    const px = [[0, 0, 0], [255, 255, 255], [128, 64, 32], [10, 200, 30], [255, 0, 0]].flatMap((p) => [...p, 255]);
    const b = binPixels(px);
    const sparse = (a: Uint32Array) => Object.fromEntries([...a].map((v, i) => [i, v] as const).filter(([, v]) => v > 0));
    expect(sparse(b.R)).toEqual({ 0: 1, 10: 1, 128: 1, 255: 2 });
    expect(sparse(b.G)).toEqual({ 0: 2, 64: 1, 200: 1, 255: 1 });
    expect(sparse(b.B)).toEqual({ 0: 2, 30: 1, 32: 1, 255: 1 });
    expect(sparse(b.L)).toEqual({ 0: 1, 54: 1, 75: 1, 147: 1, 255: 1 });
    expect(clipFlags(b)).toEqual({ shadow: true, highlight: true });
  });
  it("높이", () => {
    const bins = new Uint32Array(256);
    bins[0] = 500; bins[10] = 100; bins[100] = 25; bins[255] = 900;
    const h = histHeights(bins);
    expect([h[0], h[10], h[100], h[255]]).toEqual([1, 1, 0.5, 1]);
    expect(histHeights(new Uint32Array(256)).every((v) => v === 0)).toBe(true);
    const only = new Uint32Array(256); only[0] = 4;
    expect(histHeights(only)[0]).toBe(1);
  });
  it("클리핑 임계 0.002·N", () => {
    const px = new Uint8Array(4 * 1000).fill(100);
    expect(clipFlags(binPixels(px))).toEqual({ shadow: false, highlight: false });
    px[0] = 0; px[4] = 0;
    expect(clipFlags(binPixels(px)).shadow).toBe(true);
  });
});

describe("T13 제스처", () => {
  const g: Geometry = { Wc: 360, Hc: 640, bw: 360, bh: 240 };
  it("핀치 골든", () => {
    let r = pinch({ z0: 1, t0: { x: 0, y: 0 }, mid0: { x: 100, y: 200 }, d0: 100 }, { x: 100, y: 200 }, 250, g);
    expect([r.z, r.t.x, r.t.y]).toEqual([2.5, 120, 0]);
    r = pinch({ z0: 2, t0: { x: 10, y: 0 }, mid0: { x: 180, y: 320 }, d0: 200 }, { x: 200, y: 300 }, 100, g);
    expect([r.z, r.t.x, r.t.y]).toEqual([1, 0, 0]);
    r = pinch({ z0: 4, t0: { x: 0, y: 0 }, mid0: { x: 180, y: 320 }, d0: 100 }, { x: 180, y: 320 }, 400, g);
    expect([r.z, r.t.x, r.t.y]).toEqual([8, 0, 0]);
  });
  it("clampPan / 팬은 z>1 에서만", () => {
    expect(clampPan({ x: 999, y: 999 }, 2.5, g)).toEqual({ x: 270, y: 0 });
    expect(pan({ z: 1, t: { x: 0, y: 0 } }, 50, 50, g).t).toEqual({ x: 0, y: 0 });
    expect(pan({ z: 2.5, t: { x: 100, y: 0 } }, 50, 0, g).t.x).toBe(150);
  });
  it("더블탭 확대/복귀", () => {
    const z = doubleTapZoom({ z: 1, t: { x: 0, y: 0 } }, { x: 100, y: 200 }, g);
    expect([z.z, z.t.x]).toEqual([2.5, 120]);
    expect(doubleTapZoom(z, { x: 10, y: 10 }, g)).toEqual({ z: 1, t: { x: 0, y: 0 } });
  });
  it("보이는 영역", () => {
    const r = visibleRegion({ z: 1, t: { x: 0, y: 0 } }, g)!;
    expect([r.u0, r.u1, r.v0, r.v1]).toEqual([0, 1, 0, 1]);
    const r2 = visibleRegion({ z: 4, t: { x: 0, y: 0 } }, g)!;
    expect(r2.u0).toBeCloseTo(0.375, 12);
    expect(r2.u1).toBeCloseTo(0.625, 12);
    expect(r2.v0).toBeCloseTo(1 / 6, 12);
    expect(r2.v1).toBeCloseTo(5 / 6, 12);
  });
});

describe("T23 EXIF 요약 포맷터", () => {
  it("셔터", () => { expect(formatShutterSpeed(0.004)).toBe("1/250 s"); expect(formatShutterSpeed(1.3)).toBe("1.3 s"); expect(formatShutterSpeed(1)).toBe("1 s"); });
  it("조리개", () => { expect(formatAperture(2.8)).toBe("f/2.8"); expect(formatAperture(2)).toBe("f/2"); });
  it("바디", () => { expect(formatBody("Canon", "Canon EOS R5")).toBe("Canon EOS R5"); expect(formatBody("FUJIFILM", "X-T5")).toBe("FUJIFILM X-T5"); expect(formatBody(null, null)).toBe("—"); });
  it("초점거리", () => { expect(formatFocalLength(35, 52)).toBe("35 mm (35mm 환산 52 mm)"); expect(formatFocalLength(35, undefined)).toBe("35 mm"); });
  it("카드", () => {
    const c = buildExifCard({ Make: "FILM LAB", Model: "Demo Scene", FNumber: 2.8, ExposureTime: 0.004, ISOSpeedRatings: 200, FocalLength: 35, OffsetTimeOriginal: "+09:00", DateTimeOriginal: "2026:10:16 06:39:00" }, { width: 3000, height: 2000 });
    expect(c).toEqual({ body: "FILM LAB Demo Scene", lens: "—", aperture: "f/2.8", shutter: "1/250 s", iso: "200", focal: "35 mm", dateTime: "2026:10:16 06:39:00 +09:00", resolution: "3000 × 2000" });
  });
});

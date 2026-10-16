import { describe, expect, it } from "vitest";
import { patchTiffBytes } from "../src/lib/exif/serialize";
import { fixtureTiff } from "./helpers/fixture";

describe("tiff-bytes 저장 보정 13.5", () => {
  it("Orientation/PixelX/PixelY 만 바뀌고 나머지는 동일", () => {
    const src = fixtureTiff();
    const out = patchTiffBytes(src, { width: 8, height: 16 }, []);
    const base = 30;
    expect(Array.from(out.subarray(72 - base, 74 - base))).toEqual([1, 0]);
    expect(Array.from(out.subarray(360 - base, 362 - base))).toEqual([8, 0]);
    expect(Array.from(out.subarray(372 - base, 374 - base))).toEqual([16, 0]);
    const changed = new Set([72, 73, 360, 361, 372, 373].map((o) => o - base));
    for (let i = 0; i < src.length; i++) if (!changed.has(i)) expect(out[i]).toBe(src[i]);
    expect(src[72 - base]).toBe(6); // 원본은 변경되지 않음
  });
  it("SHORT 범위 초과 크기는 원본 유지 + report", () => {
    const rep: string[] = [];
    const out = patchTiffBytes(fixtureTiff(), { width: 70000, height: 16 }, rep);
    expect(out[360 - 30]).toBe(16);
    expect(rep.length).toBe(1);
  });
});

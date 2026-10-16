import { describe, expect, it } from "vitest";
import { TierController } from "../src/lib/render/video-source";

describe("섹션 10.5 해상도 단계", () => {
  it("60 프레임 동안 드롭 증가 > 2 → 한 단계 낮춤, 2 이하는 유지", () => {
    const t = new TierController();
    for (let i = 0; i <= 60; i++) t.onFrame(i < 30 ? 0 : 2);
    expect(t.tier).toBe(1);
    const u = new TierController();
    let changed = false;
    for (let i = 0; i <= 60; i++) changed = u.onFrame(i < 30 ? 0 : 3) || changed;
    expect(changed).toBe(true);
    expect(u.tier).toBe(0.75);
  });
  it("최저 0.5 에서 멈추고, 300 프레임 연속 증가 0 이면 한 단계 높임", () => {
    const t = new TierController();
    let d = 0;
    for (let k = 0; k < 400; k++) { d += 1; t.onFrame(d); }
    expect(t.tier).toBe(0.5);
    for (let k = 0; k < 299; k++) t.onFrame(d);
    expect(t.tier).toBe(0.5);
    t.onFrame(d);
    expect(t.tier).toBe(0.75);
    for (let k = 0; k < 300; k++) t.onFrame(d);
    expect(t.tier).toBe(1);
    for (let k = 0; k < 600; k++) t.onFrame(d);
    expect(t.tier).toBe(1);
  });
});

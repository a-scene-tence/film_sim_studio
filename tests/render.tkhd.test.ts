import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { orientationFromMatrix, parseMoov, displaySizeOf } from "../src/lib/media/video-probe";
import { PROBE_MP4_BASE64, PROBE_MP4_SHA256 } from "../src/lib/render/probe-mp4";

const F = 65536;

describe("섹션 15.2-5 tkhd 회전", () => {
  it("매핑 8가지", () => {
    const cases: Array<[number[], number]> = [
      [[1, 0, 0, 1], 1], [[-1, 0, 0, 1], 2], [[-1, 0, 0, -1], 3], [[1, 0, 0, -1], 4],
      [[0, 1, 1, 0], 5], [[0, 1, -1, 0], 6], [[0, -1, 1, 0], 8], [[0, -1, -1, 0], 7],
    ];
    for (const [m, o] of cases) {
      const r = orientationFromMatrix(m[0]! * F, m[1]! * F, m[2]! * F, m[3]! * F);
      expect(r, m.join(",")).toEqual({ orientation: o, unsupported: false });
    }
  });
  it("비정형 행렬 → 1 + 경고", () => {
    expect(orientationFromMatrix(Math.round(0.7071 * F), Math.round(0.7071 * F), Math.round(-0.7071 * F), Math.round(0.7071 * F))).toEqual({ orientation: 1, unsupported: true });
    expect(orientationFromMatrix(F, 0, 0, F * 2)).toEqual({ orientation: 1, unsupported: true });
  });
  it("프로브 MP4: sha256, orientation 6, coded 32×16, 표시 16×32", () => {
    const b = new Uint8Array(Buffer.from(PROBE_MP4_BASE64, "base64"));
    expect(createHash("sha256").update(b).digest("hex")).toBe(PROBE_MP4_SHA256);
    const p = parseMoov(b);
    expect(p.rotation.matrix).toEqual([0, F, -F, 0]);
    expect(p.rotation.orientation).toBe(6);
    expect([p.rotation.codedWidth, p.rotation.codedHeight]).toEqual([32, 16]);
    expect(displaySizeOf(p.rotation)).toEqual({ width: 16, height: 32 });
    expect(p.codecFourcc).toBe("avc1");
  });
});

import { describe, expect, it } from "vitest";
import { concat, fromAscii } from "../src/lib/media/binary";
import { parseEbml } from "../src/lib/media/ebml";

const el = (id: number[], ...payload: Uint8Array[]) => {
  const p = concat(payload);
  const n = p.length;
  return concat([Uint8Array.from(id), Uint8Array.of(0x10 | ((n >>> 24) & 0x0f), (n >>> 16) & 255, (n >>> 8) & 255, n & 255), p]);
};
const u = (n: number, len = 1) => Uint8Array.from({ length: len }, (_, i) => (n >>> (8 * (len - 1 - i))) & 255);

describe("EBML(webm) 파싱", () => {
  it("3840×2160 VP9, transfer 1, range limited", () => {
    const track = el([0xae], el([0x83], u(1)), el([0x86], fromAscii("V_VP9")), el([0xe0], el([0xb0], u(3840, 2)), el([0xba], u(2160, 2)), el([0x55, 0xb0], el([0x55, 0xba], u(1)), el([0x55, 0xbb], u(1)), el([0x55, 0xb9], u(1)))));
    const bytes = concat([el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], fromAscii("webm"))), el([0x18, 0x53, 0x80, 0x67], el([0x16, 0x54, 0xae, 0x6b], track))]);
    const r = parseEbml(bytes);
    expect([r.width, r.height, r.codecId]).toEqual([3840, 2160, "V_VP9"]);
    expect(r.colour).toEqual({ primaries: 1, transfer: 1, matrix: null, fullRange: false });
  });
});

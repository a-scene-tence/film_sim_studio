import { encode } from "fast-png";
import { describe, expect, it } from "vitest";
import { parseHald } from "@/lib/lut/parseHald";

function identityHald(L: number, depth: 8 | 16): Uint8Array {
  const N = L * L;
  const W = L * L * L;
  const max = depth === 8 ? 255 : 65535;
  const data = depth === 8 ? new Uint8Array(W * W * 3) : new Uint16Array(W * W * 3);
  for (let i = 0; i < W * W; i++) {
    data[i * 3] = Math.round(((i % N) / (N - 1)) * max);
    data[i * 3 + 1] = Math.round(((Math.floor(i / N) % N) / (N - 1)) * max);
    data[i * 3 + 2] = Math.round((Math.floor(i / (N * N)) / (N - 1)) * max);
  }
  return encode({ width: W, height: W, data, depth, channels: 3 });
}

function expectIdentity(data: Float32Array, N: number, tol: number) {
  expect(data.length).toBe(N * N * N * 3);
  let o = 0;
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
    expect(Math.abs(data[o++]! - r / (N - 1))).toBeLessThanOrEqual(tol);
    expect(Math.abs(data[o++]! - g / (N - 1))).toBeLessThanOrEqual(tol);
    expect(Math.abs(data[o++]! - b / (N - 1))).toBeLessThanOrEqual(tol);
  }
}

describe("parseHald", () => {
  it("L=4 (64×64, N=16) 8bit 항등 (±1/255)", () => {
    const { lut, errors } = parseHald(identityHald(4, 8));
    expect(errors).toEqual([]);
    expect(lut.size).toBe(16);
    expectIdentity(lut.data, 16, 1 / 255);
  });

  it("L=4 16bit 항등 (±1/65535)", () => {
    const { lut, errors } = parseHald(identityHald(4, 16));
    expect(errors).toEqual([]);
    expect(lut.size).toBe(16);
    expectIdentity(lut.data, 16, 1 / 65535);
  });

  it("60×60 거부", () => {
    const png = encode({ width: 60, height: 60, data: new Uint8Array(60 * 60 * 3), depth: 8, channels: 3 });
    const { errors, lut } = parseHald(png);
    expect(errors.length).toBeGreaterThan(0);
    expect(lut.size).toBe(0);
  });

  it("팔레트 PNG 거부", () => {
    const png = encode({
      width: 64,
      height: 64,
      data: new Uint8Array(64 * 64),
      depth: 8,
      channels: 1,
      palette: [
        [0, 0, 0],
        [255, 255, 255],
      ],
    });
    const { errors } = parseHald(png);
    expect(errors).toEqual(["팔레트 PNG는 Hald로 사용할 수 없습니다"]);
  });
});

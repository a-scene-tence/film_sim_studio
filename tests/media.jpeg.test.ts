import { describe, expect, it } from "vitest";
import { parseJpegSegments, pickLargest, scanEmbeddedJpegs, stripApp1 } from "../src/lib/media/jpeg";
import { FIXTURE_SHA256, loadFixture, mulberry32, sha256 } from "./helpers/fixture";

describe("JPEG 세그먼트 / 스캐너", () => {
  const fx = loadFixture();
  it("픽스처 전사 검증", () => {
    expect(fx.length).toBe(1370);
    expect(sha256(fx)).toBe(FIXTURE_SHA256);
  });
  it("세그먼트 순서", () => {
    const segs = parseJpegSegments(fx);
    expect(segs.map((s) => s.marker)).toEqual([0xd8, 0xe0, 0xe1, 0xdb, 0xdb, 0xc0, 0xc4, 0xc4, 0xc4, 0xc4, 0xda]);
    expect(segs[2]!.length).toBe(0x02b8);
    expect(segs[2]!.offset).toBe(20);
  });
  it("APP1 제거본에 Exif 없음", () => {
    const s = stripApp1(fx);
    expect(Buffer.from(s).includes(Buffer.from("Exif"))).toBe(false);
    expect(s.length).toBe(fx.length - (0x02b8 + 2));
  });

  const noise = () => {
    const r = mulberry32(42);
    return Uint8Array.from({ length: 200000 }, () => Math.floor(r() * 256));
  };
  it("스캐너: 잡음 속 후보 1개 (무손실 SOF 는 실패)", () => {
    const n = noise();
    n.set(fx, 1000);
    n.set([0xff, 0xd8, 0xff, 0xc3, 0x00, 0x0b, 0x08, 0x00, 0x10, 0x00, 0x10, 0x01, 0x01, 0x11, 0x00], 50000);
    const c = scanEmbeddedJpegs(n);
    expect(c).toEqual([{ offset: 1000, length: 1370, width: 16, height: 8 }]);
  });
  it("스캐너: 가장 큰 W×H 선택", () => {
    const n = noise();
    n.set(fx, 1000);
    const big = fx.slice();
    const sof = Buffer.from(big).indexOf(Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]));
    big.set([0, 32, 0, 32], sof + 5);
    n.set(big, 90000);
    const best = pickLargest(scanEmbeddedJpegs(n));
    expect(best).toMatchObject({ offset: 90000, width: 32, height: 32 });
  });
});

import { describe, expect, it } from "vitest";
import { readAscii, readRational, readTiff, readUint, type IfdMap } from "../src/lib/media/tiff";
import { fixtureTiff } from "./helpers/fixture";

const g = readTiff(fixtureTiff())!;
const chk = (m: IfdMap, tag: number, type: number, count: number) => {
  const e = m.get(tag);
  expect(e, `tag 0x${tag.toString(16)}`).toBeDefined();
  expect([e!.type, e!.count]).toEqual([type, count]);
  return e!;
};

describe("TIFF 리더 — 픽스처 사실표", () => {
  it("바이트순서와 IFD 구조", () => {
    expect(g.littleEndian).toBe(true);
    expect(g.ifd1.size).toBe(0);
  });
  it("IFD0", () => {
    expect(readAscii(chk(g.ifd0, 0x010f, 2, 9))).toBe("FUJIFILM\0");
    expect(readAscii(chk(g.ifd0, 0x0110, 2, 7))).toBe("X100VI\0");
    expect(readUint(chk(g.ifd0, 0x0112, 3, 1), 0)).toBe(6);
    expect(readRational(chk(g.ifd0, 0x011a, 5, 1), 0)).toEqual([72, 1]);
    expect(readRational(chk(g.ifd0, 0x011b, 5, 1), 0)).toEqual([72, 1]);
    expect(readUint(chk(g.ifd0, 0x0128, 3, 1), 0)).toBe(2);
    expect(readAscii(chk(g.ifd0, 0x0131, 2, 12))).toBe("Fixture 1.0\0");
    expect(readAscii(chk(g.ifd0, 0x0132, 2, 20))).toBe("2026:10:16 06:39:00\0");
    expect(readUint(chk(g.ifd0, 0x8769, 4, 1), 0)).toBe(200);
    expect(readUint(chk(g.ifd0, 0x8825, 4, 1), 0)).toBe(542);
  });
  it("Exif", () => {
    expect(readRational(chk(g.exif, 0x829a, 5, 1), 0)).toEqual([1, 250]);
    expect(readRational(chk(g.exif, 0x829d, 5, 1), 0)).toEqual([14, 5]);
    expect(readUint(chk(g.exif, 0x8827, 3, 1), 0)).toBe(400);
    expect(readAscii(chk(g.exif, 0x9003, 2, 20))).toBe("2026:10:16 06:39:00\0");
    expect(readAscii(chk(g.exif, 0x9011, 2, 7))).toBe("+09:00\0");
    expect(readRational(chk(g.exif, 0x9204, 10, 1), 0)).toEqual([-2, 3]);
    expect(readRational(chk(g.exif, 0x920a, 5, 1), 0)).toEqual([23, 1]);
    expect(Array.from(chk(g.exif, 0x927c, 1, 40).bytes)).toEqual(Array.from({ length: 40 }, (_, i) => i));
    expect(Array.from(chk(g.exif, 0x9286, 1, 13).bytes)).toEqual(Array.from(Buffer.from("ASCII\0\0\0Hello")));
    expect(readUint(chk(g.exif, 0xa001, 3, 1), 0)).toBe(1);
    expect(readUint(chk(g.exif, 0xa002, 3, 1), 0)).toBe(16);
    expect(readUint(chk(g.exif, 0xa003, 3, 1), 0)).toBe(8);
    expect(readUint(chk(g.exif, 0xa405, 3, 1), 0)).toBe(35);
    expect(readAscii(chk(g.exif, 0xa431, 2, 6))).toBe("12345\0");
    expect(readAscii(chk(g.exif, 0xa433, 2, 9))).toBe("FUJIFILM\0");
    expect(readAscii(chk(g.exif, 0xa434, 2, 14))).toBe("XF23mmF2 R WR\0");
  });
  it("GPS", () => {
    expect(Array.from(chk(g.gps, 0x0000, 1, 4).bytes)).toEqual([2, 3, 0, 0]);
    expect(readAscii(chk(g.gps, 0x0001, 2, 2))).toBe("N\0");
    const lat = chk(g.gps, 0x0002, 5, 3);
    expect([0, 1, 2].map((i) => readRational(lat, i))).toEqual([[37, 1], [33, 1], [294, 5]]);
    expect(readAscii(chk(g.gps, 0x0003, 2, 2))).toBe("E\0");
    const lon = chk(g.gps, 0x0004, 5, 3);
    expect([0, 1, 2].map((i) => readRational(lon, i))).toEqual([[126, 1], [58, 1], [234, 5]]);
    expect(Array.from(chk(g.gps, 0x0005, 1, 1).bytes)).toEqual([0]);
    expect(readRational(chk(g.gps, 0x0006, 5, 1), 0)).toEqual([77, 2]);
  });
  it("값 필드 위치 (Orientation=파일 72, PixelX=360, PixelY=372)", () => {
    expect(g.ifd0.get(0x0112)!.valueOffsetPos + 30).toBe(72);
    expect(g.exif.get(0xa002)!.valueOffsetPos + 30).toBe(360);
    expect(g.exif.get(0xa003)!.valueOffsetPos + 30).toBe(372);
  });
});

import piexif from "piexifjs";
import { describe, expect, it } from "vitest";
import { buildDictFromGroups } from "../src/lib/exif/extract";
import { extractPayload } from "../src/lib/exif/extract";
import { insertExifIntoJpeg } from "../src/lib/exif/insert-jpeg";
import { tagsAreOriginal } from "../src/lib/exif/serialize";
import type { ExifPayload } from "../src/lib/exif/serialize";
import { readAscii, readRational, readTiff, readUint, type IfdMap, type RawEntry } from "../src/lib/media/tiff";
import { fixtureTiff, loadFixture } from "./helpers/fixture";

function norm(e: RawEntry): unknown {
  const n = e.count;
  if (e.type === 2) return [2, readAscii(e)];
  if (e.type === 5 || e.type === 10) return [e.type, ...Array.from({ length: n }, (_, i) => readRational(e, i))];
  return [e.type, ...Array.from({ length: n }, (_, i) => readUint(e, i))];
}

describe("dict 경로 (piexif 동적 태그 등록)", () => {
  it("픽스처 → dict → dump → insert → 재파싱", async () => {
    const before = JSON.stringify(piexif.TAGS);
    const g = readTiff(fixtureTiff())!;
    const payload: ExifPayload = { mode: "tiff-dict", tiff: null, dict: null, dictTypes: null, xmp: null, iptcIrb: null, orientation: 6, report: [] };
    buildDictFromGroups(g, payload, false);
    expect(payload.dict!.Exif[0x9011]).toBe("+09:00");
    const { bytes } = insertExifIntoJpeg(loadFixture(), payload, { width: 8, height: 16 });
    expect(JSON.stringify(piexif.TAGS)).toBe(before);
    expect(tagsAreOriginal()).toBe(true);

    const re = await extractPayload(bytes, "jpeg");
    const g2 = readTiff(re.tiff!)!;
    expect(re.orientation).toBe(1);
    const cmp = (a: IfdMap, b: IfdMap, skip: number[], over: Record<number, unknown> = {}) => {
      for (const [tag, e] of a) {
        if (skip.includes(tag)) continue;
        expect(b.has(tag), `태그 0x${tag.toString(16)} 존재`).toBe(true);
        expect(norm(b.get(tag)!), `태그 0x${tag.toString(16)}`).toEqual(tag in over ? over[tag] : norm(e));
      }
    };
    cmp(g.ifd0, g2.ifd0, [0x8769, 0x8825], { 0x0112: [3, 1] });
    cmp(g.exif, g2.exif, [0xa005], { 0xa002: [4, 8], 0xa003: [4, 16] });
    cmp(g.gps, g2.gps, []);
    // 타입 보존
    expect(g2.exif.get(0x927c)!.type).toBe(1);
    expect(g2.exif.get(0x9286)!.type).toBe(1);
    expect(readAscii(g2.exif.get(0x9011)!)).toBe("+09:00\0");
    expect(g2.exif.get(0xa002)!.type).toBe(4);
    expect(g2.ifd0.get(0x0112)!.bytes.length).toBe(2);
  });
});

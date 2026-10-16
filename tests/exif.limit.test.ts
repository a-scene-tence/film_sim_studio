import { describe, expect, it } from "vitest";
import { buildDictFromGroups, extractPayload } from "../src/lib/exif/extract";
import { insertExifIntoJpeg } from "../src/lib/exif-manager";
import type { ExifPayload } from "../src/lib/exif/serialize";
import { parseJpegSegments, segmentPayload } from "../src/lib/media/jpeg";
import { readTiff, readUint } from "../src/lib/media/tiff";
import { dumpDictToTiff } from "../src/lib/exif/serialize";
import { fixtureTiff, loadFixture } from "./helpers/fixture";

describe("64KB 한도", () => {
  it("MakerNote 70000 바이트 → 제거 + report, Exif 페이로드 ≤ 65533", () => {
    const payload: ExifPayload = { mode: "tiff-dict", tiff: null, dict: null, dictTypes: null, xmp: null, iptcIrb: null, orientation: 1, report: [] };
    buildDictFromGroups(readTiff(fixtureTiff())!, payload, false);
    payload.dict!.Exif[0x927c] = "\x01".repeat(70000);
    payload.dictTypes!.Exif[0x927c] = "Undefined";
    const { bytes, report } = insertExifIntoJpeg(loadFixture(), payload, { width: 8, height: 16 });
    const segs = parseJpegSegments(bytes).filter((s) => s.marker === 0xe1);
    expect(segs.length).toBe(1);
    expect(segmentPayload(bytes, segs[0]!).length).toBeLessThanOrEqual(65533);
    expect(report.some((r) => r.includes("MakerNote"))).toBe(true);
  });
  it("tiff-bytes 가 한도를 넘으면 dict 로 전환한 뒤 MakerNote 를 제거한다", () => {
    const tmp: ExifPayload = { mode: "tiff-dict", tiff: null, dict: null, dictTypes: null, xmp: null, iptcIrb: null, orientation: 1, report: [] };
    buildDictFromGroups(readTiff(fixtureTiff())!, tmp, false);
    tmp.dict!.Exif[0x927c] = "\x02".repeat(70000);
    tmp.dictTypes!.Exif[0x927c] = "Undefined";
    const big = dumpDictToTiff(tmp.dict!, tmp.dictTypes!);
    expect(big.length).toBeGreaterThan(65527);
    const payload: ExifPayload = { mode: "tiff-bytes", tiff: big, dict: null, dictTypes: null, xmp: null, iptcIrb: null, orientation: 6, report: [] };
    const { bytes, report } = insertExifIntoJpeg(loadFixture(), payload, { width: 8, height: 16 });
    expect(report.some((r) => r.includes("tiff-dict"))).toBe(true);
    expect(report.some((r) => r.includes("MakerNote"))).toBe(true);
    const seg = parseJpegSegments(bytes).find((x) => x.marker === 0xe1)!;
    expect(segmentPayload(bytes, seg).length).toBeLessThanOrEqual(65533);
    const g = readTiff(segmentPayload(bytes, seg).subarray(6))!;
    expect(readUint(g.ifd0.get(0x0112)!, 0)).toBe(1);
    expect(g.exif.has(0x927c)).toBe(false);
    expect(g.exif.has(0x829a)).toBe(true);
  });
  it("정상 크기 tiff-bytes 는 전환하지 않는다", async () => {
    const base = await extractPayload(loadFixture(), "jpeg");
    const { report } = insertExifIntoJpeg(loadFixture(), base, { width: 8, height: 16 });
    expect(report.some((r) => r.includes("tiff-dict"))).toBe(false);
  });
});

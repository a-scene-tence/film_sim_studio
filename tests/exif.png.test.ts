import { encode } from "fast-png";
import { describe, expect, it } from "vitest";
import { crc32 } from "../src/lib/exif/crc32";
import { extractPayload } from "../src/lib/exif/extract";
import { insertExifIntoPng } from "../src/lib/exif-manager";
import { tiffOrientation } from "../src/lib/exif/serialize";
import { u32be } from "../src/lib/media/binary";
import { parsePngChunks } from "../src/lib/media/png-chunks";
import { loadFixture } from "./helpers/fixture";

describe("PNG 삽입 13.7", () => {
  it("XMP 없이: 청크 순서 IHDR, eXIf, IDAT, IEND", async () => {
    const png = encode({ width: 2, height: 2, data: new Uint8Array(12).fill(128), channels: 3, depth: 8 });
    const { bytes } = insertExifIntoPng(png, await extractPayload(loadFixture(), "jpeg"), { width: 8, height: 16 });
    expect(parsePngChunks(bytes).map((c) => c.type)).toEqual(["IHDR", "eXIf", "IDAT", "IEND"]);
  });
  it("청크 순서 / CRC / Orientation=1", async () => {
    const png = encode({ width: 2, height: 2, data: new Uint8Array(12).fill(128), channels: 3, depth: 8 });
    const payload = await extractPayload(loadFixture(), "jpeg");
    payload.xmp = new TextEncoder().encode('<x:xmpmeta tiff:Orientation="6"/>');
    payload.iptcIrb = new Uint8Array([1]);
    const { bytes, report } = insertExifIntoPng(png, payload, { width: 8, height: 16 });
    const chunks = parsePngChunks(bytes);
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "eXIf", "iTXt", "IDAT", "IEND"]);
    const c = chunks[1]!;
    const data = bytes.subarray(c.dataStart, c.dataEnd);
    expect(u32be(bytes, c.dataEnd)).toBe(crc32(bytes.subarray(c.start + 4, c.dataStart), data));
    expect(tiffOrientation(data)).toBe(1);
    expect(report).toContain("PNG 에는 IPTC 를 기록하지 않음");
    const back = await extractPayload(bytes, "png");
    expect(back.orientation).toBe(1);
    expect(new TextDecoder().decode(back.xmp!)).toContain('tiff:Orientation="1"');
  });
});

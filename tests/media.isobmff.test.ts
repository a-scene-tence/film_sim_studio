import { describe, expect, it } from "vitest";
import { concat, fromAscii, writeU16be, writeU32be } from "../src/lib/media/binary";
import { detectLog } from "../src/lib/media/log-detect";
import { parseMoov } from "../src/lib/media/video-probe";

const box = (type: string, ...payload: Uint8Array[]) => {
  const p = concat(payload);
  return concat([writeU32be(8 + p.length), fromAscii(type), p]);
};
const full = (type: string, ...payload: Uint8Array[]) => box(type, new Uint8Array(4), ...payload);

function visualEntry(fourcc: string, w: number, h: number, ...kids: Uint8Array[]) {
  const head = new Uint8Array(78);
  head.set(writeU16be(w), 24);
  head.set(writeU16be(h), 26);
  return box(fourcc, head, ...kids);
}

function moovWith(entry: Uint8Array, extraStbl: Uint8Array[] = []) {
  return box(
    "moov",
    box(
      "trak",
      box(
        "mdia",
        full("mdhd", writeU32be(0), writeU32be(0), writeU32be(60000), writeU32be(600000)),
        full("hdlr", writeU32be(0), fromAscii("vide"), new Uint8Array(13)),
        box(
          "minf",
          box(
            "stbl",
            full("stsd", writeU32be(1), entry),
            full("stts", writeU32be(1), writeU32be(120), writeU32be(1001)),
            full("stsz", writeU32be(0), writeU32be(1), writeU32be(4096)),
            full("stco", writeU32be(1), writeU32be(48)),
            ...extraStbl,
          ),
        ),
      ),
    ),
  );
}

describe("ISOBMFF moov 파싱", () => {
  it("HEVC 10bit HLG: 코덱 문자열·fps·colr·감지", () => {
    const hvcC = new Uint8Array(23);
    hvcC[0] = 1;
    hvcC[1] = 0x02;
    hvcC.set([0x20, 0, 0, 0], 2);
    hvcC.set([0x90, 0, 0, 0, 0, 0], 6);
    hvcC[12] = 153;
    hvcC[17] = 0xfa; // bitDepthLumaMinus8 = 2 (명세 본문 식 (b[17]&7)+8; 테스트 입력의 0xF9 는 9bit 이므로 0xFA 사용 — 보고서 참조)
    const colr = box("colr", fromAscii("nclx"), writeU16be(9), writeU16be(18), writeU16be(9), Uint8Array.of(0));
    const p = parseMoov(moovWith(visualEntry("hvc1", 3840, 2160, box("hvcC", hvcC), colr)));
    expect(p.codec).toBe("hvc1.2.4.L153.90");
    expect(p.bitDepth).toBe(10);
    expect(Math.abs(p.fps - 59.9401)).toBeLessThan(1e-3);
    expect(p.colour).toEqual({ primaries: 9, transfer: 18, matrix: 9, fullRange: false });
    expect([p.width, p.height]).toEqual([3840, 2160]);
    expect(p.durationSec).toBeCloseTo(10, 6);
    expect(p.firstSample).toEqual({ offset: 48, size: 4096, keyFirst: true });
    const d = detectLog({ colour: p.colour, fileName: "clip.mov", metaText: "", make: null, histogram: null });
    expect([d.profile, d.confidence, d.autoApply, d.primaries]).toEqual(["hlg", "tag", true, "rec2020"]);
  });
  it("AVC: avc1.640033", () => {
    const p = parseMoov(moovWith(visualEntry("avc1", 1920, 1080, box("avcC", Uint8Array.of(1, 0x64, 0x00, 0x33, 0xff)))));
    expect(p.codec).toBe("avc1.640033");
    expect(p.bitDepth).toBe(8);
    expect(p.config?.kind).toBe("avcC");
  });
  it("PQ 는 오류", () => {
    expect(() => detectLog({ colour: { primaries: 9, transfer: 16, matrix: 9, fullRange: false }, fileName: "a.mov", metaText: "", make: null, histogram: null })).toThrow(/PQ/);
  });
});

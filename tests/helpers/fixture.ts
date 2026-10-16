import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export const FIXTURE_SHA256 = "17313b031c0b2fae7b97ee75b9dc074508cac909ccd91bf6a473679dfe71a6ca";

export function loadFixture(): Uint8Array {
  const b64 = readFileSync(new URL("../fixtures/exif-ii.jpg.b64", import.meta.url), "utf8").trim();
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export function sha256(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

/** TIFF 시작 = 파일 오프셋 30, APP1 길이 0x02B8 */
export const FIXTURE_TIFF_START = 30;
export function fixtureTiff(): Uint8Array {
  return loadFixture().slice(FIXTURE_TIFF_START, FIXTURE_TIFF_START + 0x2b8 - 8);
}

export function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

import { ascii, extOf, matches, u16be, u16le, u32be, u32le } from "./binary";
import { errors } from "./errors";
import type { SourceFormat } from "./types";

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/** IFD0 에 DNGVersion(0xC612) 이 있는지 (앞 64KB 안에서만 검사) */
function tiffHasDngVersion(b: Uint8Array): boolean {
  const le = b[0] === 0x49;
  const r16 = (o: number) => (le ? u16le(b, o) : u16be(b, o));
  const r32 = (o: number) => (le ? u32le(b, o) : u32be(b, o));
  const ifd = r32(4);
  if (ifd + 2 > b.length) return false;
  const n = r16(ifd);
  for (let i = 0; i < n && ifd + 2 + i * 12 + 12 <= b.length; i++) if (r16(ifd + 2 + i * 12) === 0xc612) return true;
  return false;
}

/** 7. 파일 앞 64KB 매직 바이트 기준, 확장자는 보조 */
export function sniffFormat(head: Uint8Array, fileName: string): SourceFormat {
  const ext = extOf(fileName);
  if (matches(head, 0, [0xff, 0xd8, 0xff])) return "jpeg";
  if (matches(head, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") return "webp";
  if (ascii(head, 0, 16) === "FUJIFILMCCD-RAW ") return "raf";
  if (matches(head, 0, [0x1a, 0x45, 0xdf, 0xa3])) return "webm";
  if (ascii(head, 4, 4) === "ftyp") {
    const size = Math.min(u32be(head, 0) || head.length, head.length);
    const brands = [ascii(head, 8, 4)];
    for (let o = 16; o + 4 <= size; o += 4) brands.push(ascii(head, o, 4));
    if (brands.includes("crx ")) return "cr3";
    if (brands.some((b) => HEIC_BRANDS.has(b))) return "heic";
    return ext === "mov" || brands[0] === "qt  " ? "mov" : "mp4";
  }
  if (matches(head, 0, [0x49, 0x49, 0x2a, 0x00]) || matches(head, 0, [0x4d, 0x4d, 0x00, 0x2a])) {
    if (tiffHasDngVersion(head)) return "dng";
    if (ext === "arw") return "arw";
    if (ext === "nef") return "nef";
    if (ext === "dng") return "dng";
    throw errors.unsupportedFormat(ext);
  }
  const first = ascii(head, 4, 4);
  if (["moov", "mdat", "wide", "free", "skip"].includes(first)) {
    if (ext === "mov") return "mov";
    if (ext === "mp4") return "mp4";
  }
  throw errors.unsupportedFormat(ext);
}

export function kindOf(f: SourceFormat): "raw" | "image" | "video" {
  if (f === "arw" || f === "dng" || f === "nef" || f === "raf" || f === "cr3") return "raw";
  if (f === "mp4" || f === "mov" || f === "webm") return "video";
  return "image";
}

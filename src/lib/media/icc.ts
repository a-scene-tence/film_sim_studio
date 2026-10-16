import { ascii, u32be } from "./binary";
import type { SourcePrimaries } from "./types";

/** 8.7 ICC 프로파일 desc 태그 문자열 */
export function iccDescription(p: Uint8Array): string {
  if (p.length < 132) return "";
  const n = u32be(p, 128);
  for (let i = 0; i < n && 132 + i * 12 + 12 <= p.length; i++) {
    const o = 132 + i * 12;
    if (ascii(p, o, 4) !== "desc") continue;
    const off = u32be(p, o + 4);
    const type = ascii(p, off, 4);
    if (type === "desc") {
      const len = u32be(p, off + 8);
      return ascii(p, off + 12, Math.max(0, len - 1));
    }
    if (type === "mluc") {
      const len = u32be(p, off + 20), off2 = u32be(p, off + 24);
      let s = "";
      for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode((p[off + off2 + k]! << 8) | p[off + off2 + k + 1]!);
      return s;
    }
  }
  return "";
}

export function classifyDescription(desc: string): { primaries: SourcePrimaries; known: boolean } {
  const d = desc.toLowerCase();
  if (d.includes("p3")) return { primaries: "display-p3", known: true };
  if (d.includes("srgb")) return { primaries: "srgb", known: true };
  if (d.includes("adobe rgb") || d.includes("adobergb")) return { primaries: "adobe-rgb", known: true };
  if (d.includes("2020")) return { primaries: "rec2020", known: true };
  return { primaries: "srgb", known: false };
}

export function classifyIcc(profile: Uint8Array): { primaries: SourcePrimaries; description: string; known: boolean } {
  const description = iccDescription(profile);
  return { ...classifyDescription(description), description };
}

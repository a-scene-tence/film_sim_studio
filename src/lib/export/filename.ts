// Step 4 §10-7 파일명 exportName(원본명, simTag, 시작시각, ext)
export type ExportExt = "jpg" | "png" | "mp4" | "webm";

const p2 = (n: number) => String(n).padStart(2, "0");
export const timestamp = (d: Date): string => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;

export function exportName(original: string, simTag: string | null, start: Date, ext: ExportExt): string {
  let base = original.replace(/\.[^./\\]+$/, "").replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "");
  if (base === "") base = "filmlab";
  base = Array.from(base).slice(0, 60).join("");
  return `${base}_${simTag ?? "nofilm"}_${timestamp(start)}.${ext}`;
}

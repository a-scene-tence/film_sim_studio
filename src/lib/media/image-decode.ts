import { decode as decodePng } from "fast-png";
import { needsReducedDecode } from "./budget";
import { classifyDescription, classifyIcc } from "./icc";
import { applyOrientationRows } from "./proxy-rows";
import { orientedSize } from "./orientation";
import { proxySize, resampleRows } from "./resample";
import type { PixelBufferF32, SourceDescriptor, SourcePrimaries } from "./types";
import { warnings as W } from "./errors";

export interface ImageDecodeResult {
  proxy: PixelBufferF32;
  /** 원본 해상도(방향 반영) */
  displaySize: { width: number; height: number };
  descriptor: SourceDescriptor;
  decodeStrategy: string;
  warnings: string[];
}

/** 8.6 워커 시작 시 1회 탐지 */
let p3Cache: boolean | null = null;
export function supportsP3Canvas(): boolean {
  if (p3Cache !== null) return p3Cache;
  try {
    const c = new OffscreenCanvas(1, 1).getContext("2d", { colorSpace: "display-p3" }) as { getContextAttributes?: () => { colorSpace?: string } } | null;
    p3Cache = !!c && typeof c.getContextAttributes === "function" && c.getContextAttributes().colorSpace === "display-p3";
  } catch {
    p3Cache = false;
  }
  return p3Cache;
}

const BMP_OPTS = { premultiplyAlpha: "none", colorSpaceConversion: "default" } as const;

export const imageDescriptor = (primaries: SourcePrimaries, bitDepth = 8): SourceDescriptor => ({ profile: "srgb-image", primaries, range: "full", bitDepth, rawScale: null });

/** 브라우저 디코드 → RGBA8 (8.2 3~4, 8.6, 10.4) */
export async function decodeToRgba8(blob: Blob, origW: number | null, origH: number | null, budgetBytes: number): Promise<{ data: Uint8ClampedArray; width: number; height: number; primaries: SourcePrimaries; reduced: boolean }> {
  const p3 = supportsP3Canvas();
  const colorSpace = p3 ? "display-p3" : "srgb";
  let bmp: ImageBitmap;
  let reduced = false;
  if (origW && origH && needsReducedDecode(origW, origH, budgetBytes) && Math.max(origW, origH) > 4096) {
    const s = 4096 / Math.max(origW, origH);
    const rw = origW >= origH ? 4096 : Math.max(1, Math.round(origW * s));
    const rh = origH > origW ? 4096 : Math.max(1, Math.round(origH * s));
    reduced = true;
    bmp = await createImageBitmap(blob, { ...BMP_OPTS, resizeWidth: rw, resizeHeight: rh, resizeQuality: "high" });
    if (bmp.width !== rw || bmp.height !== rh) {
      const c = new OffscreenCanvas(rw, rh);
      const g = c.getContext("2d")!;
      g.imageSmoothingQuality = "high";
      g.drawImage(bmp, 0, 0, rw, rh);
      bmp.close();
      bmp = c.transferToImageBitmap();
    }
  } else {
    bmp = await createImageBitmap(blob, BMP_OPTS);
  }
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext("2d", { colorSpace, willReadFrequently: true });
  if (!g) throw new Error("2D 캔버스를 만들 수 없습니다");
  g.drawImage(bmp, 0, 0);
  const width = bmp.width, height = bmp.height;
  bmp.close();
  const img = g.getImageData(0, 0, width, height, { colorSpace });
  return { data: img.data, width, height, primaries: p3 ? "display-p3" : "srgb", reduced };
}

/** RGBA8 + 방향 → 장축 ≤ 2048 프록시 (srgb-image 평균은 선형 영역) */
export function proxyFromRgba8(img: { data: Uint8ClampedArray; width: number; height: number }, orientation: number): PixelBufferF32 {
  const o = applyOrientationRows(orientation, img.width, img.height);
  const { width: w, height: h } = proxySize(o.width, o.height);
  const data = resampleRows(o.width, o.height, w, h, "srgb-image", (y, row) => {
    o.fillRow(y, (si, x) => { row[x * 3] = img.data[si]! / 255; row[x * 3 + 1] = img.data[si + 1]! / 255; row[x * 3 + 2] = img.data[si + 2]! / 255; }, 4);
  });
  return { width: w, height: h, data };
}

/** 이미 디코드한 비트맵(예: 비디오 프레임) → 프록시 (방향 1) */
export function proxyFromBitmapCanvas(bmp: ImageBitmap): PixelBufferF32 {
  const { width: w, height: h } = proxySize(bmp.width, bmp.height);
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext("2d", { colorSpace: "srgb", willReadFrequently: true })!;
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h, { colorSpace: "srgb" }).data;
  const out = new Float32Array(w * h * 4);
  for (let i = 0; i < out.length; i++) out[i] = (i & 3) === 3 ? 1 : px[i]! / 255;
  return { width: w, height: h, data: out };
}

/** 8.3 16비트 PNG: fast-png 원값 보존 */
export function decodePng16(bytes: Uint8Array, orientation: number, budgetBytes: number): { proxy: PixelBufferF32; primaries: SourcePrimaries; width: number; height: number; warn: string[] } {
  const png = decodePng(bytes);
  const { width, height, channels } = png;
  if (width * height * channels * 2 > budgetBytes / 2) throw new Error("16비트 PNG 가 메모리 한도를 넘습니다");
  let primaries: SourcePrimaries = "srgb";
  const warn: string[] = [];
  const icc = png.iccEmbeddedProfile;
  if (icc) {
    const r = classifyIcc(icc.profile);
    if (r.description) { primaries = r.primaries; if (!r.known) warn.push(W.unknownIcc(r.description)); }
    else {
      const n = classifyDescription(icc.name);
      primaries = n.primaries;
      if (!n.known) warn.push(W.unknownIcc(icc.name));
    }
  }
  const src = png.data as Uint16Array | Uint8Array;
  const max = png.depth === 16 ? 65535 : 255;
  const o = applyOrientationRows(orientation, width, height);
  const { width: w, height: h } = proxySize(o.width, o.height);
  const data = resampleRows(o.width, o.height, w, h, "srgb-image", (y, row) => {
    o.fillRow(y, (si, x) => {
      const i = (si / 4) * channels;
      const r = src[i]! / max;
      row[x * 3] = r;
      row[x * 3 + 1] = channels >= 3 ? src[i + 1]! / max : r;
      row[x * 3 + 2] = channels >= 3 ? src[i + 2]! / max : r;
    }, 4);
  });
  return { proxy: { width: w, height: h, data }, primaries, width, height, warn };
}

/** 원본 해상도(방향 반영) */
export function displaySizeOf(o: number, W0: number, H0: number): { width: number; height: number } {
  return orientedSize(o, W0, H0);
}

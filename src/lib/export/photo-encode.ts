// Step 4 §10-3 인코더 옵션과 인코드 (워커·테스트 공용). JPEG = @jsquash/jpeg(mozjpeg WASM), PNG = fast-png.
import encodeJpegRaw, { init as initJpegRaw } from "@jsquash/jpeg/encode.js";
import type { EncodeOptions } from "@jsquash/jpeg/meta.js";
import { encode as encodePngRaw } from "fast-png";

export type ExportMode = "original" | "compress";

export interface JpegPlan { mode: ExportMode; quality?: number; width: number; height: number }

/** §10-3 JPEG 옵션: 모드 1 = quality 100·4:4:4, 모드 2 = quality q, chroma_subsample = q ≥ 90 ? 1 : 2 */
export function jpegOptions(p: JpegPlan): EncodeOptions {
  const common = {
    baseline: false, arithmetic: false, progressive: p.width * p.height <= 30_000_000, optimize_coding: true, smoothing: 0,
    color_space: 3, quant_table: 3, trellis_multipass: false, trellis_opt_zero: false, trellis_opt_table: false,
    trellis_loops: 1, auto_subsample: false, separate_chroma_quality: false,
  };
  if (p.mode === "original") return { ...common, quality: 100, chroma_subsample: 1, chroma_quality: 100 } as EncodeOptions;
  const q = p.quality ?? 90;
  return { ...common, quality: q, chroma_subsample: q >= 90 ? 1 : 2, chroma_quality: q } as EncodeOptions;
}

/** 컴파일된 WASM 모듈로 한 번 초기화한다 (워커 안에서 캐시) */
export async function initJpeg(module: WebAssembly.Module): Promise<void> {
  await (initJpegRaw as unknown as (m: WebAssembly.Module) => Promise<void>)(module);
}

export async function encodeJpeg(rgba: Uint8ClampedArray, width: number, height: number, options: EncodeOptions): Promise<Uint8Array> {
  const buf = await encodeJpegRaw({ data: rgba, width, height, colorSpace: "srgb" } as unknown as ImageData, options);
  return new Uint8Array(buf);
}

/** 알파를 제거한 RGB 8비트 PNG. zlib 옵션은 기본값 */
export function encodePng(rgba: ArrayLike<number>, width: number, height: number): Uint8Array {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < width * height * 4; i += 4) { rgb[j++] = rgba[i]!; rgb[j++] = rgba[i + 1]!; rgb[j++] = rgba[i + 2]!; }
  return encodePngRaw({ width, height, data: rgb, channels: 3, depth: 8 });
}

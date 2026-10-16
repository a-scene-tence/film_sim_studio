import type { LibRawMetadata, LibRawSettings } from "libraw-wasm";
import { createLibRaw } from "./libraw-loader";
import { errors } from "./errors";

/** 9.3 현상 설정 (정확히 이 키들만 지정하고 나머지는 패키지 기본값) */
export function rawSettings(halfSize: boolean): LibRawSettings {
  return {
    halfSize, useCameraWb: true, useAutoWb: false, useCameraMatrix: 1, outputColor: 1, outputBps: 16, gamm: [1, 1],
    noAutoBright: true, highlight: 0, userFlip: 0, userQual: 3, adjustMaximumThr: 0, expCorrec: false,
  };
}

export interface RawPixels { width: number; height: number; colors: number; data: Uint16Array }
export interface RawDecodeResult { pixels: RawPixels; meta: LibRawMetadata }

/** K_raw = 2.04 × 2^BE (BE 가 유한수가 아니거나 DNG 가 아니면 0) */
export function computeKRaw(meta: LibRawMetadata, isDng: boolean): number {
  const be = meta.color_data?.dng_levels?.baseline_exposure;
  const e = isDng && typeof be === "number" && Number.isFinite(be) ? be : 0;
  return 2.04 * Math.pow(2, e);
}

/** LibRaw 로 RAW 를 현상한다. dispose() 를 반드시 호출한다 (공유 메모리 해제). */
export async function decodeRaw(file: Blob, halfSize: boolean): Promise<RawDecodeResult> {
  const lr = await createLibRaw();
  try {
    // open() 은 버퍼를 transfer 하므로 호출마다 새 버퍼를 읽는다
    const bytes = new Uint8Array(await file.arrayBuffer());
    await lr.open(bytes, rawSettings(halfSize));
    const meta = await lr.metadata(true);
    const img = await lr.imageData();
    if (!meta || !img) throw errors.decodeFailed("LibRaw 결과가 비어 있습니다");
    if (!(img.data instanceof Uint16Array) || img.colors !== 3) throw errors.decodeFailed(`예상하지 못한 LibRaw 출력 (colors=${img.colors}, bits=${img.bits})`);
    return { pixels: { width: img.width, height: img.height, colors: img.colors, data: img.data }, meta };
  } finally {
    lr.dispose();
  }
}

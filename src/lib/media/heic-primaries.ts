import { heicPrimaries } from "./heic";
import type { SourcePrimaries } from "./types";

/** 8.5-4 heic2any 폴백 경로의 원색 (원본 HEIC 의 colr 로 판정) */
export function buildHeicPrimaries(heic: Uint8Array): SourcePrimaries {
  return heicPrimaries(heic);
}

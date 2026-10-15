export type LutInputDomain = "srgb-display" | "rec709-bt1886" | "fsh-v1" | "slog3-sgamut3cine";
export type LutRole = "look" | "source-transform";
export interface LutData { id: string; name: string; size: number; data: Float32Array; domainMin: [number,number,number]; domainMax: [number,number,number]; inVideoRange: boolean; outVideoRange: boolean; inputDomain: LutInputDomain; role: LutRole; sourceProfile: "samsung-log" | "dji-dlog-m" | null; sourceFileName: string; sha256: string; createdAt: number; warnings: string[] }

/** 파서 결과의 LUT 부분 (메타데이터 제외) */
export type ParsedLut = Omit<LutData, "id" | "name" | "inputDomain" | "role" | "sourceProfile" | "sourceFileName" | "sha256" | "createdAt">;

export interface ParseResult {
  lut: ParsedLut;
  errors: string[];
}

/** 1D 를 3D 로 굽거나 1D+3D 를 합성할 때의 격자 크기 */
export const BAKE_SIZE = 33;

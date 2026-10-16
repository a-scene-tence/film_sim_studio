// 섹션 13 — 내장 LUT(manifest bin, "?v=" + sha256Bin 앞 12자, 최근 4개 LRU) 와 lutStore 의 외부 Look/소스 변환 LUT.
import { decodeBinLut } from "../lut/binLut";
import { getLut, listLuts, type LutMeta } from "../lut/lutStore";
import type { LutData, LutInputDomain } from "../lut/types";

export interface ManifestSim { id: string; brand: "fujifilm" | "ricoh"; ko: string; en: string; mono: boolean; order: number; bin: string; sha256Bin: string }
export interface LutManifest { size: number; sims: ManifestSim[] }

let manifestPromise: Promise<LutManifest> | null = null;

export function loadManifest(): Promise<LutManifest> {
  manifestPromise ??= fetch("/luts/manifest.json").then(async (r) => {
    if (!r.ok) throw new Error(`manifest HTTP ${r.status}`);
    return (await r.json()) as LutManifest;
  }).catch((e: unknown) => {
    manifestPromise = null;
    throw e;
  });
  return manifestPromise;
}

/** CPU 측 데이터 (GPU 텍스처는 렌더러가 관리) */
export interface CpuLut { key: string; size: number; data: Float32Array }

const builtinCache = new Map<string, Promise<CpuLut>>();
const LRU_MAX = 4;

/** 내장 LUT 의 Float32 데이터. 최근 4개를 유지한다 */
export function loadBuiltinLut(sim: ManifestSim, N: number): Promise<CpuLut> {
  const hit = builtinCache.get(sim.id);
  if (hit) {
    builtinCache.delete(sim.id);
    builtinCache.set(sim.id, hit);
    return hit;
  }
  const p = fetch(`${sim.bin}?v=${sim.sha256Bin.slice(0, 12)}`).then(async (r) => {
    if (!r.ok) throw new Error(`${sim.id} HTTP ${r.status}`);
    return { key: `builtin:${sim.id}`, size: N, data: decodeBinLut(await r.arrayBuffer(), N) };
  });
  p.catch(() => builtinCache.delete(sim.id));
  builtinCache.set(sim.id, p);
  while (builtinCache.size > LRU_MAX) {
    const oldest = builtinCache.keys().next().value as string;
    builtinCache.delete(oldest);
  }
  return p;
}

export function builtinKeysInCache(): string[] {
  return [...builtinCache.keys()].map((k) => `builtin:${k}`);
}

export const DOMAIN_INDEX: Readonly<Record<LutInputDomain, number>> = { "srgb-display": 0, "rec709-bt1886": 1, "fsh-v1": 2, "slog3-sgamut3cine": 3 };

export interface StoreLut extends CpuLut { meta: Omit<LutData, "data"> }

const storeCache = new Map<string, Promise<StoreLut | null>>();

export function loadStoreLut(id: string): Promise<StoreLut | null> {
  let p = storeCache.get(id);
  if (!p) {
    p = getLut(id).then((l) => {
      if (!l) return null;
      const { data, ...meta } = l;
      return { key: `store:${id}`, size: l.size, data, meta };
    });
    p.catch(() => storeCache.delete(id));
    storeCache.set(id, p);
  }
  return p;
}

/** Step 2 프로파일 id → lutStore sourceProfile */
export function storeSourceProfile(profile: string): "samsung-log" | "dji-dlog-m" | null {
  return profile === "samsunglog" ? "samsung-log" : profile === "dlogm" ? "dji-dlog-m" : null;
}

export async function listStoreLuts(): Promise<LutMeta[]> {
  try {
    return await listLuts();
  } catch {
    return [];
  }
}

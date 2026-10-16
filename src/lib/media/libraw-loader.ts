// libraw-wasm 은 번들러를 완전히 우회해 정적 경로로만 로드한다 (CLAUDE.md §2-11).
import type LibRaw from "libraw-wasm";
import { errors } from "./errors";

export type LibRawInstance = InstanceType<typeof LibRaw>;

const nativeImport = new Function("u", "return import(u)") as (u: string) => Promise<{ default: new () => LibRawInstance }>;
export const LIBRAW_URL = "/vendor/libraw-wasm/1.6.0/index.js";

/** crossOriginIsolated 가 아니면 NOT_CROSS_ORIGIN_ISOLATED 를 던진다 (SharedArrayBuffer 필요). */
export async function createLibRaw(): Promise<LibRawInstance> {
  if (globalThis.crossOriginIsolated !== true) throw errors.notCrossOriginIsolated();
  const mod = await nativeImport(LIBRAW_URL);
  return new mod.default();
}

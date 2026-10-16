import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { LutData } from "./types";

/** IndexedDB 저장 형식: data 는 ArrayBuffer */
export type StoredLut = Omit<LutData, "data"> & { data: ArrayBuffer };
export type LutMeta = Omit<LutData, "data">;

interface FilmLabDB extends DBSchema {
  luts: { key: string; value: StoredLut };
}

const DB_NAME = "film-lab";
const DB_VERSION = 1;
const STORE = "luts";

let dbPromise: Promise<IDBPDatabase<FilmLabDB>> | null = null;

function db(): Promise<IDBPDatabase<FilmLabDB>> {
  dbPromise ??= openDB<FilmLabDB>(DB_NAME, DB_VERSION, {
    upgrade(d) {
      d.createObjectStore(STORE, { keyPath: "id" });
    },
  });
  return dbPromise;
}

/** id = "user-" + sha256(원본 파일 바이트) 앞 16 hex */
export function lutIdFromSha256(sha256Hex: string): string {
  return "user-" + sha256Hex.slice(0, 16);
}

/** 같은 id(같은 파일)는 덮어쓴다. */
export async function putLut(lut: LutData): Promise<void> {
  const { data, ...meta } = lut;
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  await (await db()).put(STORE, { ...meta, data: buf });
}

/** 메타데이터만(data 제외), 생성 시각 순 */
export async function listLuts(): Promise<LutMeta[]> {
  const all = await (await db()).getAll(STORE);
  return all
    .map((s): LutMeta => {
      const meta: Partial<StoredLut> = { ...s };
      delete meta.data;
      return meta as LutMeta;
    })
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function getLut(id: string): Promise<LutData | undefined> {
  const s = await (await db()).get(STORE, id);
  if (!s) return undefined;
  return { ...s, data: new Float32Array(s.data) };
}

export async function deleteLut(id: string): Promise<void> {
  await (await db()).delete(STORE, id);
}

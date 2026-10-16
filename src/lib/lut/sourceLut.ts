// Step 4 §4-5 (H) 공식 소스 변환 LUT 등록·조회·해제. 파싱은 lut-parse 워커, 저장은 lutStore(IndexedDB).
import type { LutParseRequest, LutParseResponse } from "../../workers/lut-parse.worker";
import { deleteLut, listLuts, lutIdFromSha256, putLut, type LutMeta } from "./lutStore";
import type { LutData } from "./types";

export type OfficialProfile = "samsunglog" | "dlogm";
const STORE_PROFILE = { samsunglog: "samsung-log", dlogm: "dji-dlog-m" } as const;

function parseInWorker(req: LutParseRequest): Promise<LutParseResponse> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../../workers/lut-parse.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<LutParseResponse>) => { worker.terminate(); resolve(ev.data); };
    worker.onerror = (ev) => { worker.terminate(); reject(new Error(ev.message || "워커 오류")); };
    worker.postMessage(req, [req.bytes]);
  });
}

/** 해당 프로파일용으로 등록된 소스 변환 LUT 메타 (없으면 null) */
export async function findSourceLut(profile: OfficialProfile): Promise<LutMeta | null> {
  try {
    return (await listLuts()).find((l) => l.role === "source-transform" && l.sourceProfile === STORE_PROFILE[profile]) ?? null;
  } catch {
    return null;
  }
}

/** .cube / HaldCLUT(.png) 파일을 파싱해 등록한다. 같은 프로파일의 기존 LUT 는 교체한다. 오류는 한국어 메시지로 던진다 */
export async function registerSourceLut(profile: OfficialProfile, file: File): Promise<LutMeta> {
  const kind = file.name.toLowerCase().endsWith(".png") ? "hald" : "cube";
  const res = await parseInWorker({ kind, bytes: await file.arrayBuffer(), fileName: file.name });
  if (res.errors.length > 0) throw new Error(`LUT 를 읽지 못했습니다: ${res.errors.join(" ")}`);
  const lut: LutData = {
    ...res.lut, id: lutIdFromSha256(res.sha256), name: file.name, inputDomain: "srgb-display", role: "source-transform",
    sourceProfile: STORE_PROFILE[profile], sourceFileName: file.name, sha256: res.sha256, createdAt: Date.now(),
  };
  const old = await findSourceLut(profile);
  await putLut(lut);
  if (old && old.id !== lut.id) await deleteLut(old.id);
  const { data, ...meta } = lut;
  void data;
  return meta;
}

/** LUT 해제 (내장 변환으로 복귀) */
export async function removeSourceLut(profile: OfficialProfile): Promise<void> {
  const cur = await findSourceLut(profile);
  if (cur) await deleteLut(cur.id);
}

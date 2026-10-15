/// <reference lib="webworker" />
import { parseCube } from "@/lib/lut/parseCube";
import { parseHald } from "@/lib/lut/parseHald";
import type { ParsedLut } from "@/lib/lut/types";

export interface LutParseRequest {
  kind: "cube" | "hald";
  bytes: ArrayBuffer;
  fileName: string;
}

export interface LutParseResponse {
  fileName: string;
  sha256: string;
  lut: ParsedLut;
  errors: string[];
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (ev: MessageEvent<LutParseRequest>) => {
  const { kind, bytes, fileName } = ev.data;
  let res: LutParseResponse;
  try {
    const sha256 = await sha256Hex(bytes);
    const parsed =
      kind === "cube" ? parseCube(new TextDecoder("utf-8").decode(bytes)) : parseHald(new Uint8Array(bytes));
    res = { fileName, sha256, ...parsed };
  } catch (e) {
    res = {
      fileName,
      sha256: "",
      lut: { size: 0, data: new Float32Array(0), domainMin: [0, 0, 0], domainMax: [1, 1, 1], inVideoRange: false, outVideoRange: false, warnings: [] },
      errors: [`파싱 중 예기치 못한 오류: ${e instanceof Error ? e.message : String(e)} — 파일 형식을 확인하세요.`],
    };
  }
  ctx.postMessage(res, [res.lut.data.buffer]);
};

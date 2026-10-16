/// <reference lib="webworker" />
// Step 4 §10-4(3) 내보내기 워커: JPEG(mozjpeg WASM)·PNG 인코드, 선형광 스트리밍 다운샘플, EXIF 재삽입·검증.
import { AreaDownsampler } from "../lib/export/area-downsample";
import { renderFramed } from "../lib/export/frame-render";
import type { FrameLayout, FrameText, FrameTheme } from "../lib/export/frame";
import { encodeJpeg, encodePng, initJpeg } from "../lib/export/photo-encode";
import { inspectOutputExif, insertExifIntoJpeg, insertExifIntoPng, type ExifPayload } from "../lib/exif-manager";
import type { EncodeOptions } from "@jsquash/jpeg/meta.js";

const MOZJPEG_WASM_URL = "/vendor/jsquash-jpeg/1.6.0/mozjpeg_enc.wasm";
type Fmt = "jpeg" | "png";
/** Step 5: 사진 아래·주변에 EXIF 여백 프레임을 합성한다 */
export interface FramePayload { layout: FrameLayout; theme: FrameTheme; text: FrameText }

export type ExportRequest =
  | { id: number; type: "init" }
  | { id: number; type: "encode-full"; rgba: ArrayBuffer; w: number; h: number; format: Fmt; options: EncodeOptions; frame?: FramePayload }
  | { id: number; type: "down-begin"; W: number; H: number; W2: number; H2: number }
  | { id: number; type: "down-band"; rows: ArrayBuffer; y0: number; rowCount: number }
  | { id: number; type: "down-end"; format: Fmt; options: EncodeOptions; frame?: FramePayload }
  | { id: number; type: "estimate"; rgba: ArrayBuffer; w: number; h: number; format: Fmt; options: EncodeOptions; frame?: FramePayload }
  | { id: number; type: "exif"; bytes: ArrayBuffer; format: Fmt; payload: ExifPayload; outSize: { width: number; height: number } };

export type ExportResponse =
  | { id: number; type: "progress"; value: number }
  | { id: number; type: "done"; bytes?: ArrayBuffer; length?: number; report?: string[] }
  | { id: number; type: "error"; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let ready: Promise<void> | null = null;
let down: AreaDownsampler | null = null;

function ensureInit(): Promise<void> {
  ready ??= (async () => {
    let mod: WebAssembly.Module;
    try {
      mod = await WebAssembly.compileStreaming(fetch(MOZJPEG_WASM_URL));
    } catch {
      const r = await fetch(MOZJPEG_WASM_URL);
      if (!r.ok) throw new Error(`mozjpeg_enc.wasm 을 불러오지 못했습니다 (HTTP ${r.status}) — 네트워크 연결 또는 오프라인 캐시를 확인하고 새로고침하세요.`);
      mod = await WebAssembly.compile(await r.arrayBuffer());
    }
    await initJpeg(mod);
  })();
  ready.catch(() => { ready = null; });
  return ready;
}

async function encode(rgba: Uint8ClampedArray, w: number, h: number, format: Fmt, options: EncodeOptions, frame?: FramePayload): Promise<Uint8Array> {
  if (frame) {
    const f = renderFramed(rgba, w, h, frame.layout, frame.theme, frame.text);
    rgba = f.rgba; w = f.width; h = f.height;
  }
  if (format === "jpeg") { await ensureInit(); return encodeJpeg(rgba, w, h, options); }
  return encodePng(rgba, w, h);
}

function post(m: ExportResponse, transfer: Transferable[] = []): void {
  ctx.postMessage(m, transfer);
}

function done(id: number, bytes: Uint8Array, report?: string[]): void {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  post({ id, type: "done", bytes: buf, report }, [buf]);
}

ctx.onmessage = async (ev: MessageEvent<ExportRequest>) => {
  const m = ev.data;
  try {
    switch (m.type) {
      case "init":
        await ensureInit();
        post({ id: m.id, type: "done" });
        return;
      case "encode-full": {
        const out = await encode(new Uint8ClampedArray(m.rgba), m.w, m.h, m.format, m.options, m.frame);
        done(m.id, out);
        return;
      }
      case "down-begin":
        down = new AreaDownsampler(m.W, m.H, m.W2, m.H2);
        post({ id: m.id, type: "done" });
        return;
      case "down-band": {
        if (!down) throw new Error("다운샘플이 시작되지 않았습니다");
        const px = new Uint8ClampedArray(m.rows);
        const rowLen = down.W * 4;
        for (let r = 0; r < m.rowCount; r++) down.pushRow(px.subarray(r * rowLen, (r + 1) * rowLen), m.y0 + r);
        post({ id: m.id, type: "done" });
        return;
      }
      case "down-end": {
        if (!down) throw new Error("다운샘플이 시작되지 않았습니다");
        const d = down;
        down = null;
        done(m.id, await encode(d.out, d.W2, d.H2, m.format, m.options, m.frame));
        return;
      }
      case "estimate": {
        const out = await encode(new Uint8ClampedArray(m.rgba), m.w, m.h, m.format, m.options, m.frame);
        post({ id: m.id, type: "done", length: out.length });
        return;
      }
      case "exif": {
        const src = new Uint8Array(m.bytes);
        const r = m.format === "jpeg" ? insertExifIntoJpeg(src, m.payload, m.outSize) : insertExifIntoPng(src, m.payload, m.outSize);
        const rep = await inspectOutputExif(r.bytes, m.format);
        if (rep.orientation !== 1) throw new Error(`EXIF 검증 실패: Orientation=${rep.orientation} (1 이어야 함)`);
        if (rep.pixelX !== null && (rep.pixelX !== m.outSize.width || rep.pixelY !== m.outSize.height)) {
          throw new Error(`EXIF 검증 실패: PixelXDimension/YDimension = ${rep.pixelX}×${rep.pixelY} (기대 ${m.outSize.width}×${m.outSize.height})`);
        }
        done(m.id, r.bytes, r.report);
        return;
      }
    }
  } catch (e) {
    post({ id: m.id, type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};

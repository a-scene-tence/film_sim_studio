// Step 4 §10 사진 저장 파이프라인: 계획(메모리 검사) → 타일 렌더(renderTile) → 스트리밍 다운샘플/인코드(워커) → EXIF 재삽입·검증.
import type { ExifSummary } from "../exif-manager";
import { getBudget, type MediaAsset } from "../media-loader";
import type { FilmRenderer } from "../render/renderer";
import { estimateBytes, photoMemoryPlan, type PhotoFormat } from "./estimate";
import { exportName } from "./filename";
import { buildFrameText, framedSize, type FrameOptions, type FrameText } from "./frame";
import { outSize, type SizeOption } from "./out-size";
import { jpegOptions, type ExportMode } from "./photo-encode";
import { tileGrid } from "./tile-grid";
import { ExportCancelled, type ExportClient } from "./worker-client";

export interface PhotoExportOptions {
  format: PhotoFormat;
  mode: ExportMode;
  size: SizeOption;
  /** 용량 압축 모드 화질 60~98 */
  quality: number;
  /** Step 5: EXIF 여백 프레임 (생략 = 끔) */
  frame?: FrameOptions;
}

/** 프레임 각인에 필요한 정보: EXIF 요약 + 필름 배지 문구 */
export interface FrameInfo { summary: ExifSummary | null | undefined; badge: string }
export const frameOn = (o: PhotoExportOptions): boolean => o.frame?.enabled === true;

/** 워커로 보낼 프레임 페이로드 (프레임이 꺼져 있으면 undefined) */
export function framePayload(o: PhotoExportOptions, info: FrameInfo | undefined): { layout: FrameOptions["layout"]; theme: FrameOptions["theme"]; text: FrameText } | undefined {
  if (!o.frame?.enabled) return undefined;
  return { layout: o.frame.layout, theme: o.frame.theme, text: buildFrameText(info?.summary, info?.badge ?? "") };
}

export const defaultPhotoOptions = (): PhotoExportOptions => ({ format: "jpeg", mode: "original", size: "full", quality: 90 });

/** 모드 1(원본 화질)은 해상도 100%, 모드 2(용량 압축)는 선택 해상도 */
export function effectiveSize(o: PhotoExportOptions): SizeOption {
  return o.mode === "original" ? "full" : o.size;
}

export function encoderOptions(o: PhotoExportOptions, W2: number, H2: number) {
  const f = framedSize(W2, H2, o.frame ?? { enabled: false, theme: "white", layout: "bottom" });
  return jpegOptions({ mode: o.mode, quality: o.quality, width: f.width, height: f.height });
}

export interface PhotoPlan {
  W: number; H: number; W2: number; H2: number;
  need: number;
  fits: boolean;
  /** 2048px 로도 못 담는가 (메시지 분기) */
  hopeless: boolean;
}

export const MEMORY_MSG = "이 기기 메모리로는 이 해상도를 저장하기 어렵습니다. 4096px 또는 2048px 압축 저장을 선택하세요.";
export const HOPELESS_MSG = "이 사진은 이 기기에서 저장할 수 없습니다";

export function planPhoto(asset: Pick<MediaAsset, "displaySize">, o: PhotoExportOptions, est: number, budgetBytes = getBudget().budgetBytes): PhotoPlan {
  const { width: W, height: H } = asset.displaySize;
  const s = outSize(W, H, effectiveSize(o));
  const fs = framedSize(s.width, s.height, o.frame ?? { enabled: false, theme: "white", layout: "bottom" });
  const extra = frameOn(o) ? fs.width * fs.height * 4 : 0;
  const m = photoMemoryPlan(W, H, s.width, s.height, est, budgetBytes, extra);
  const small = outSize(W, H, 2048);
  const sf = framedSize(small.width, small.height, o.frame ?? { enabled: false, theme: "white", layout: "bottom" });
  const hopeless = !m.fits && !photoMemoryPlan(W, H, small.width, small.height, est, budgetBytes, frameOn(o) ? sf.width * sf.height * 4 : 0).fits;
  return { W, H, W2: fs.width, H2: fs.height, need: m.need, fits: m.fits, hopeless };
}

/** Step 2 가 삽입할 EXIF 세그먼트 바이트 길이의 근사: TIFF 본문 + APP1 헤더 10바이트 */
export function exifSegmentLength(asset: Pick<MediaAsset, "exif">): number {
  const p = asset.exif?.payload;
  return p?.tiff ? p.tiff.length + 10 : 0;
}

/** §10-6 프록시를 한 번 렌더해(RGBA8) 같은 옵션으로 인코드한 바이트 → 예상 용량 */
export async function estimatePhoto(client: ExportClient, renderer: FilmRenderer, asset: MediaAsset, o: PhotoExportOptions, proxyCache?: { width: number; height: number; data: Uint8ClampedArray }, frameInfo?: FrameInfo): Promise<number> {
  const { width: W, height: H } = asset.displaySize;
  const s = outSize(W, H, effectiveSize(o));
  const snap = proxyCache ?? renderer.snapshotPreview();
  const copy = new Uint8ClampedArray(snap.data); // 워커로 보내면 버퍼가 분리되므로 복사본을 보낸다
  const off = { enabled: false, theme: "white", layout: "bottom" } as const;
  const fp = framedSize(snap.width, snap.height, o.frame ?? off);
  const fo = framedSize(s.width, s.height, o.frame ?? off);
  const r = await client.call({ type: "estimate", rgba: copy.buffer, w: snap.width, h: snap.height, format: o.format, options: encoderOptions(o, s.width, s.height), frame: framePayload(o, frameInfo) }, [copy.buffer]);
  return estimateBytes(r.length ?? 0, fp.width * fp.height, fo.width * fo.height, o.format, exifSegmentLength(asset));
}

export interface ExportProgress { value: number; phase: "render" | "encode" | "exif"; tile: number; tiles: number }
export interface ExportJob { cancelled: boolean }
export interface PhotoResult { blob: Blob; file: File; width: number; height: number; bytes: number; report: string[] }

export async function exportPhoto(args: {
  renderer: FilmRenderer; client: ExportClient; asset: MediaAsset; simId: string | null; options: PhotoExportOptions; job: ExportJob; frameInfo?: FrameInfo;
  start: Date; onProgress(p: ExportProgress): void;
}): Promise<PhotoResult> {
  const { renderer, client, asset, options: o, job } = args;
  const { width: W, height: H } = asset.displaySize;
  const { width: W2, height: H2 } = outSize(W, H, effectiveSize(o));
  const tiles = tileGrid(W, H, 1024);
  const check = () => { if (job.cancelled) throw new ExportCancelled(); };
  const report: string[] = [];
  renderer.setSuspended(true);
  try {
    await client.call({ type: "init" });
    check();
    renderer.renderNow(); // renderTile 은 현재 파라미터로 그려진 미리보기 체인을 재사용한다
    const full = W2 === W && H2 === H ? new Uint8ClampedArray(W * H * 4) : null;
    if (!full) await client.call({ type: "down-begin", W, H, W2, H2 });
    let band: Uint8ClampedArray | null = null;
    let bandY = 0;
    for (let k = 0; k < tiles.length; k++) {
      check();
      const t = tiles[k]!;
      const px = await renderer.renderTile({ rect: { x: t.x, y: t.y, width: t.w, height: t.h }, outScale: 1 });
      check();
      if (full) {
        for (let r = 0; r < t.h; r++) full.set(px.subarray(r * t.w * 4, (r + 1) * t.w * 4), ((t.y + r) * W + t.x) * 4);
      } else {
        if (t.x === 0) { band = new Uint8ClampedArray(W * t.h * 4); bandY = t.y; }
        for (let r = 0; r < t.h; r++) band!.set(px.subarray(r * t.w * 4, (r + 1) * t.w * 4), (r * W + t.x) * 4);
        if (t.x + t.w >= W) {
          const rows = band!.buffer as ArrayBuffer;
          await client.call({ type: "down-band", rows, y0: bandY, rowCount: t.h }, [rows]);
          band = null;
        }
      }
      args.onProgress({ value: (0.8 * (k + 1)) / tiles.length, phase: "render", tile: k + 1, tiles: tiles.length });
    }
    check();
    args.onProgress({ value: 0.8, phase: "encode", tile: tiles.length, tiles: tiles.length });
    const options = encoderOptions(o, W2, H2);
    const frame = framePayload(o, args.frameInfo);
    const out = framedSize(W2, H2, o.frame ?? { enabled: false, theme: "white", layout: "bottom" });
    let enc;
    if (full) {
      const buf = full.buffer as ArrayBuffer;
      enc = await client.call({ type: "encode-full", rgba: buf, w: W, h: H, format: o.format, options, frame }, [buf]);
    } else {
      enc = await client.call({ type: "down-end", format: o.format, options, frame });
    }
    check();
    if (!enc.bytes) throw new Error("인코드 결과가 비어 있습니다 — 다시 시도하세요");
    args.onProgress({ value: 0.97, phase: "exif", tile: tiles.length, tiles: tiles.length });
    let bytes = enc.bytes;
    const payload = asset.exif?.payload;
    if (payload) {
      const r = await client.call({ type: "exif", bytes, format: o.format, payload, outSize: out }, [bytes]);
      if (!r.bytes) throw new Error("EXIF 삽입 결과가 비어 있습니다 — 다시 시도하세요");
      bytes = r.bytes;
      report.push(...(r.report ?? []));
    }
    check();
    args.onProgress({ value: 1, phase: "exif", tile: tiles.length, tiles: tiles.length });
    const ext = o.format === "jpeg" ? "jpg" : "png";
    const type = o.format === "jpeg" ? "image/jpeg" : "image/png";
    const blob = new Blob([bytes], { type });
    const file = new File([blob], exportName(asset.fileName, args.simId, args.start, ext), { type });
    return { blob, file, width: out.width, height: out.height, bytes: blob.size, report };
  } finally {
    renderer.setSuspended(false);
  }
}

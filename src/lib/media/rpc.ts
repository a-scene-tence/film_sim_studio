import type { Budget } from "./budget";
import type { MediaAsset, LoadStage, SourceDescriptor, SourcePrimaries, SourceProfileId, LogDetection } from "./types";

export type WorkerAsset = Omit<MediaAsset, "proxy"> & { proxy: { width: number; height: number; data: ArrayBuffer } };

export interface RawPixelsMessage {
  id: number; op: "raw-pixels"; ok: boolean; error?: string;
  width?: number; height?: number; colors?: number; data?: Uint16Array; meta?: unknown;
}

export type Request =
  | { id: number; op: "load"; file: File; budget: Budget; crossOriginIsolated: boolean }
  | { id: number; op: "heic-png"; ok: boolean; png?: ArrayBuffer; error?: string }
  | RawPixelsMessage
  | { id: number; op: "video-frame-bitmap"; ok: boolean; bitmap?: ImageBitmap; error?: string }
  | { id: number; op: "tile"; assetId: string; rect: { x: number; y: number; width: number; height: number } }
  | { id: number; op: "set-profile"; assetId: string; profile: SourceProfileId; primaries?: SourcePrimaries }
  | { id: number; op: "render-original"; assetId: string; maxLongEdge: number; proxy: { width: number; height: number; data: ArrayBuffer } }
  | { id: number; op: "dispose"; assetId: string | null };

export type Response =
  | { id: number; type: "progress"; stage: LoadStage; message: string }
  | { id: number; type: "preview"; bitmap: ImageBitmap; width: number; height: number }
  | { id: number; type: "needs-main-heic" }
  | { id: number; type: "needs-main-raw"; halfSize: boolean }
  | { id: number; type: "needs-main-video-frame" }
  | { id: number; type: "result"; asset: WorkerAsset }
  | { id: number; type: "tile-result"; width: number; height: number; data: ArrayBuffer }
  | { id: number; type: "profile-result"; descriptor: SourceDescriptor; detection: LogDetection | null; warnings: string[] }
  | { id: number; type: "render-result"; bitmap: ImageBitmap; proxy: { width: number; height: number; data: ArrayBuffer } }
  | { id: number; type: "disposed" }
  | { id: number; type: "error"; code: string; message: string; proxy?: { width: number; height: number; data: ArrayBuffer } };

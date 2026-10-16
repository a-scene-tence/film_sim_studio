import { proxyFromBitmapCanvas } from "./image-decode";
import { computeStats, luma709 } from "./histogram";
import type { FirstSample, VideoConfigBox } from "./video-probe";
import type { HistogramStats, PixelBufferF32, VideoInfo } from "./types";

export interface FirstFrame { proxy: PixelBufferF32; stats: HistogramStats }

const WEBCODECS_FOURCC = new Set(["avc1", "avc3", "hvc1", "hev1"]);

function yBits(fmt: string): number | null {
  switch (fmt) {
    case "I420": case "I422": case "I444": case "NV12": return 8;
    case "I420P10": case "I422P10": case "I444P10": return 10;
    case "I420P12": case "I422P12": case "I444P12": return 12;
    default: return null;
  }
}

/** 11.3-1 WebCodecs 경로. 사용 불가·실패 시 null (호출자가 폴백으로 간다). */
export async function webCodecsFirstFrame(file: Blob, info: VideoInfo, config: VideoConfigBox | null, first: FirstSample | null): Promise<FirstFrame | null> {
  if (typeof VideoDecoder === "undefined" || typeof EncodedVideoChunk === "undefined") return null;
  if (!WEBCODECS_FOURCC.has(info.codecFourcc) || !config || !first || !first.keyFirst || first.size <= 0) return null;
  const cfg: VideoDecoderConfig = { codec: info.codec, description: config.payload as BufferSource, codedWidth: info.width, codedHeight: info.height, hardwareAcceleration: "no-preference" };
  try {
    const sup = await VideoDecoder.isConfigSupported(cfg);
    if (!sup.supported) return null;
    const data = new Uint8Array(await file.slice(first.offset, first.offset + first.size).arrayBuffer());
    let frame: VideoFrame | null = null;
    let err: unknown = null;
    const dec = new VideoDecoder({ output: (f) => { frame ??= f; if (frame !== f) f.close(); }, error: (e) => { err = e; } });
    try {
      dec.configure(cfg);
      dec.decode(new EncodedVideoChunk({ type: "key", timestamp: 0, data }));
      await dec.flush();
    } finally {
      if (dec.state !== "closed") dec.close();
    }
    const f = frame as VideoFrame | null;
    if (err || !f) return null;
    try {
      const rect = f.visibleRect ?? { x: 0, y: 0, width: f.codedWidth, height: f.codedHeight };
      const W = rect.width, H = rect.height;
      const fmt = f.format ?? "";
      let getV: ((x: number, y: number) => number) | null = null;
      const bits = yBits(fmt);
      if (bits) {
        const buf = new Uint8Array(f.allocationSize());
        const layout = await f.copyTo(buf);
        const { offset, stride } = layout[0]!;
        const dv = new DataView(buf.buffer);
        const limited = info.colour.fullRange !== true;
        const k = 2 ** (bits - 8);
        const max = 2 ** bits - 1;
        getV = (x, y) => {
          const Y = bits === 8 ? buf[offset + y * stride + x]! : dv.getUint16(offset + y * stride + x * 2, true);
          const v = limited ? (Y - 16 * k) / (219 * k) : Y / max;
          return Math.min(1, Math.max(0, v));
        };
      } else if (fmt === "RGBA" || fmt === "RGBX" || fmt === "BGRA" || fmt === "BGRX") {
        const buf = new Uint8Array(f.allocationSize());
        const layout = await f.copyTo(buf);
        const { offset, stride } = layout[0]!;
        const bgr = fmt.startsWith("B");
        getV = (x, y) => {
          const i = offset + y * stride + x * 4;
          const r = buf[i + (bgr ? 2 : 0)]! / 255, g = buf[i + 1]! / 255, b = buf[i + (bgr ? 0 : 2)]! / 255;
          return luma709(r, g, b);
        };
      }
      if (!getV) return null;
      const stats = computeStats(W, H, getV);
      const bmp = await createImageBitmap(f);
      const proxy = proxyFromBitmapCanvas(bmp);
      bmp.close();
      return { proxy, stats };
    } finally {
      f.close();
    }
  } catch {
    return null;
  }
}

/** 11.3-2 폴백: 메인이 만든 비디오 프레임 비트맵 → 프록시 + 통계 (통계는 ≤2048 래스터 기준) */
export function frameFromBitmap(bmp: ImageBitmap): FirstFrame {
  const proxy = proxyFromBitmapCanvas(bmp);
  const d = proxy.data;
  const stats = computeStats(proxy.width, proxy.height, (x, y) => {
    const i = (y * proxy.width + x) * 4;
    return luma709(d[i]!, d[i + 1]!, d[i + 2]!);
  });
  return { proxy, stats };
}

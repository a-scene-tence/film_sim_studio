import { canvasTransform } from "./orientation";
import { pickLargest, scanEmbeddedJpegs, stripApp1 } from "./jpeg";

/** ImageBitmap 에 EXIF 방향을 적용한 새 ImageBitmap (원본은 닫는다) */
export async function orientBitmap(bmp: ImageBitmap, o: number): Promise<ImageBitmap> {
  if (o === 1) return bmp;
  const swap = o >= 5 && o <= 8;
  const c = new OffscreenCanvas(swap ? bmp.height : bmp.width, swap ? bmp.width : bmp.height);
  const g = c.getContext("2d");
  if (!g) return bmp;
  const t = canvasTransform(o, bmp.width, bmp.height);
  g.setTransform(t[0], t[1], t[2], t[3], t[4], t[5]);
  g.drawImage(bmp, 0, 0);
  bmp.close();
  return c.transferToImageBitmap();
}

export interface RawPreview { jpeg: Uint8Array; width: number; height: number; offset: number }

/** 9.1 내장 JPEG 중 W×H 최대 후보 (APP1 제거본) */
export function findRawPreview(bytes: Uint8Array): RawPreview | null {
  const best = pickLargest(scanEmbeddedJpegs(bytes));
  if (!best) return null;
  return { jpeg: stripApp1(bytes.subarray(best.offset, best.offset + best.length)), width: best.width, height: best.height, offset: best.offset };
}

/** 표시 전용 프리뷰 비트맵 (방향 적용) */
export async function decodeRawPreviewBitmap(p: RawPreview, orientation: number): Promise<ImageBitmap> {
  const bmp = await createImageBitmap(new Blob([p.jpeg as BlobPart], { type: "image/jpeg" }), { premultiplyAlpha: "none", colorSpaceConversion: "default" });
  return orientBitmap(bmp, orientation);
}

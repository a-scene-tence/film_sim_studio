// Step 4 §7-5 필름 카드 썸네일: 프록시를 긴 변 160px 로 줄여 별도 렌더러로 한 장씩(setTimeout 0) 렌더하고 가운데를 정사각형으로 자른다.
import type { MediaAsset, PixelBufferF32 } from "../media-loader";
import { FilmRenderer } from "../render/renderer";
import { buildRenderParams } from "./uniforms";
import { selectSim, type EditState } from "./state";

/** 박스 평균 다운샘플 (긴 변 = long). 이미 작으면 그대로 */
export function downscaleProxy(p: PixelBufferF32, long: number): PixelBufferF32 {
  const L = Math.max(p.width, p.height);
  if (L <= long) return p;
  const r = L / long;
  const w = Math.max(1, Math.round(p.width / r)), h = Math.max(1, Math.round(p.height / r));
  const out = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * p.height) / h), y1 = Math.max(y0 + 1, Math.ceil(((y + 1) * p.height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * p.width) / w), x1 = Math.max(x0 + 1, Math.ceil(((x + 1) * p.width) / w));
      let a = 0, b = 0, c = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * p.width + xx) * 4; a += p.data[i]!; b += p.data[i + 1]!; c += p.data[i + 2]!; n++; }
      const o = (y * w + x) * 4;
      out[o] = a / n; out[o + 1] = b / n; out[o + 2] = c / n; out[o + 3] = 1;
    }
  }
  return { width: w, height: h, data: out };
}

export interface ThumbJob {
  asset: MediaAsset;
  base: EditState;
  /** null = 필름 없음 */
  simIds: ReadonlyArray<string | null>;
  iso: number | null;
  onThumb(id: string, url: string): void;
}

/** 시작하고 취소 함수를 돌려준다 */
export function startThumbnails(job: ThumbJob): () => void {
  let cancelled = false;
  let renderer: FilmRenderer | null = null;
  const canvas = document.createElement("canvas");
  const dpr = Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, 2);
  const px = Math.round(76 * dpr);
  const crop = document.createElement("canvas");
  crop.width = px;
  crop.height = px;
  const c2 = crop.getContext("2d");
  void (async () => {
    try {
      renderer = FilmRenderer.create(canvas);
      const small = downscaleProxy(job.asset.proxy, 160);
      const clone: MediaAsset = { ...job.asset, id: `${job.asset.id}:thumb`, kind: "image", video: null, proxy: small, displaySize: { width: small.width, height: small.height }, previewOnly: false };
      renderer.setPhotoSource(clone);
      for (const id of job.simIds) {
        await new Promise<void>((r) => setTimeout(r, 0));
        if (cancelled || !c2) return;
        const st = { ...selectSim(job.base, id, job.iso), filmStrength: 100 };
        renderer.setParams(buildRenderParams(st, { iso: job.iso }));
        await renderer.whenReady();
        if (cancelled) return;
        renderer.renderNow();
        const s = Math.min(canvas.width, canvas.height);
        c2.drawImage(canvas, (canvas.width - s) / 2, (canvas.height - s) / 2, s, s, 0, 0, px, px);
        job.onThumb(id ?? "none", crop.toDataURL("image/jpeg", 0.82));
      }
    } catch {
      /* 썸네일 실패는 이름만 보여 주는 카드로 대체한다 */
    } finally {
      renderer?.dispose();
      renderer = null;
    }
  })();
  return () => { cancelled = true; };
}

// 섹션 14-8 검증 — GPU↔CPU 프로브, 그레인 프로브, 타일 이음새, 성능.
import type { MediaAsset } from "../media-loader";
import { pixelPipeline } from "./reference";
import type { FilmRenderer } from "./renderer";

export interface ProbeRow { u: number; v: number; gpu: [number, number, number]; cpu: [number, number, number]; diff255: number }
export interface ProbeReport { pass: boolean; maxDiff255: number; tol255: number; rows: ProbeRow[] }

/** 4×4 격자 ((i+0.5)/4, (j+0.5)/4) 에서 GPU(RGBA16F, 디더 끔)와 CPU 참조를 비교한다 */
export async function gpuCpuProbe(r: FilmRenderer, asset: MediaAsset, grainAmount: number, tol255: number): Promise<ProbeReport> {
  if (asset.kind === "video") throw new Error("프로브는 사진 전용입니다 — 사진을 연 뒤 실행하세요.");
  await r.whenReady();
  const points: Array<[number, number]> = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) points.push([(i + 0.5) / 4, (j + 0.5) / 4]);
  const gpu = r.probe(points, { grainAmount });
  const { ctx, R } = r.referenceContext({ grainAmount });
  const p = asset.proxy;
  const rows: ProbeRow[] = [];
  let maxD = 0;
  points.forEach(([u, v], k) => {
    const x = Math.min(R.width - 1, Math.floor(u * R.width));
    const y = Math.min(R.height - 1, Math.floor(v * R.height));
    const sx = Math.min(p.width - 1, Math.floor(((x + 0.5) * p.width) / R.width));
    const sy = Math.min(p.height - 1, Math.floor(((y + 0.5) * p.height) / R.height));
    const i = (sy * p.width + sx) * 4;
    const src = [p.data[i]!, p.data[i + 1]!, p.data[i + 2]!];
    const cpu = pixelPipeline(src, (x + 0.5) / R.width, (y + 0.5) / R.height, x + 0.5, y + 0.5, ctx);
    const g: [number, number, number] = [gpu[k * 4]!, gpu[k * 4 + 1]!, gpu[k * 4 + 2]!];
    const d = Math.max(Math.abs(g[0] - cpu[0]), Math.abs(g[1] - cpu[1]), Math.abs(g[2] - cpu[2])) * 255;
    maxD = Math.max(maxD, d);
    rows.push({ u, v, gpu: g, cpu, diff255: d });
  });
  return { pass: maxD <= tol255, maxDiff255: maxD, tol255, rows };
}

export interface SeamReport { pass: boolean; maxDiff255: number; rect: { x: number; y: number; width: number; height: number }; note: string }

/** 가로로 인접한 두 타일과 두 타일을 덮는 단일 타일의 같은 픽셀 비교 (outScale 1) */
export async function tileSeamCheck(r: FilmRenderer, asset: MediaAsset): Promise<SeamReport> {
  if (asset.kind === "video") throw new Error("타일 렌더는 사진 전용입니다.");
  await r.whenReady();
  r.renderNow();
  const W = asset.displaySize.width, H = asset.displaySize.height;
  const w = Math.min(256, Math.floor(W / 2)), h = Math.min(256, H);
  const x0 = Math.max(0, Math.floor(W / 2) - w), y0 = Math.max(0, Math.floor((H - h) / 2));
  const A = await r.renderTile({ rect: { x: x0, y: y0, width: w, height: h }, outScale: 1 });
  const B = await r.renderTile({ rect: { x: x0 + w, y: y0, width: w, height: h }, outScale: 1 });
  const C = await r.renderTile({ rect: { x: x0, y: y0, width: 2 * w, height: h }, outScale: 1 });
  let maxD = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < 2 * w; x++) {
      const src = x < w ? A : B;
      const sx = x < w ? x : x - w;
      const a = (y * w + sx) * 4, c = (y * 2 * w + x) * 4;
      for (let k = 0; k < 3; k++) maxD = Math.max(maxD, Math.abs(src[a + k]! - C[c + k]!));
    }
  }
  return { pass: maxD <= 1, maxDiff255: maxD, rect: { x: x0, y: y0, width: 2 * w, height: h }, note: `원본 ${W}×${H}, 타일 ${w}×${h} ×2` };
}

export interface PerfReport { photoAvgCpuMs: number | null; photoAvgPasses: number | null; video: { presentedFps: number; dropped: number; tier: number } | null }

export async function photoPerf(r: FilmRenderer): Promise<PerfReport> {
  await r.whenReady();
  let ms = 0, passes = 0;
  for (let i = 0; i < 30; i++) {
    const s = r.renderNow();
    ms += s.cpuMs;
    passes += s.passes;
    await new Promise((res) => requestAnimationFrame(() => res(null)));
  }
  return { photoAvgCpuMs: ms / 30, photoAvgPasses: passes / 30, video: null };
}

export async function videoPerf(r: FilmRenderer): Promise<PerfReport> {
  await r.video.play();
  const d0 = r.video.stats().dropped;
  await new Promise((res) => setTimeout(res, 10000));
  const s = r.video.stats();
  return { photoAvgCpuMs: null, photoAvgPasses: null, video: { presentedFps: s.presentedFps, dropped: s.dropped - d0, tier: s.tier } };
}

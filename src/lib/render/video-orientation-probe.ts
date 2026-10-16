// 섹션 10.2 브라우저 업로드 방향 판별 — 회전 영상 첫 로드 시 1회, 결과 캐시.
import { createTex2D, setUnpackState, type Target } from "./gl";
import type { RenderGraph } from "./graph";
import { PROBE_MP4_BASE64, PROBE_MP4_SHA256 } from "./probe-mp4";

export interface OrientationProbeResult {
  status: "rotated" | "not-rotated" | "unknown";
  textureRotated: boolean;
  dimsRotated: boolean | null;
  samples: Record<"A" | "B" | "C" | "D", [number, number, number]> | null;
  note: string;
}

let cached: Promise<OrientationProbeResult> | null = null;

export function cachedOrientationProbe(): Promise<OrientationProbeResult> | null {
  return cached;
}

function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function sha256Hex(b: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", b.slice().buffer));
  return Array.from(h, (x) => x.toString(16).padStart(2, "0")).join("");
}

const isRed = (p: [number, number, number]) => p[0] > 160 && p[2] < 96;
const isBlue = (p: [number, number, number]) => p[2] > 160 && p[0] < 96;

export function probeVideoOrientation(graph: RenderGraph): Promise<OrientationProbeResult> {
  cached ??= run(graph).catch((e: unknown) => {
    cached = null;
    throw e;
  });
  return cached;
}

async function run(graph: RenderGraph): Promise<OrientationProbeResult> {
  const bytes = b64ToBytes(PROBE_MP4_BASE64);
  const sha = await sha256Hex(bytes);
  if (sha !== PROBE_MP4_SHA256) return { status: "unknown", textureRotated: false, dimsRotated: null, samples: null, note: `프로브 영상 sha256 불일치 (${sha.slice(0, 12)}…)` };
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "video/mp4" }));
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  try {
    const ok = await new Promise<boolean>((res) => {
      const t = setTimeout(() => res(false), 4000);
      v.onloadeddata = () => { clearTimeout(t); res(true); };
      v.onerror = () => { clearTimeout(t); res(false); };
      v.src = url;
    });
    if (!ok) return { status: "unknown", textureRotated: false, dimsRotated: null, samples: null, note: "loadeddata 4000ms 초과 또는 디코드 실패" };
    const dimsRotated = v.videoWidth === 16 && v.videoHeight === 32;
    const gl = graph.gl;
    const tex = createTex2D(gl, 1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR, null);
    setUnpackState(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, v);
    const out: Target = graph.pool.acquire(64, 64, "rgba8");
    graph.draw({ pass: "probe", target: out, size: { width: 64, height: 64 }, tex: { uIn: tex } });
    const px = new Uint8Array(64 * 64 * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    graph.pool.release(out);
    gl.deleteTexture(tex);
    const at = (u: number, w: number): [number, number, number] => {
      const x = Math.floor(64 * u), y = Math.floor(64 * w);
      const i = (y * 64 + x) * 4;
      return [px[i]!, px[i + 1]!, px[i + 2]!];
    };
    const samples = { A: at(0.25, 0.5), B: at(0.75, 0.5), C: at(0.5, 0.25), D: at(0.5, 0.75) };
    if (isRed(samples.A) && isBlue(samples.B)) return { status: "not-rotated", textureRotated: false, dimsRotated, samples, note: "" };
    if (isRed(samples.C) && isBlue(samples.D)) return { status: "rotated", textureRotated: true, dimsRotated, samples, note: "" };
    return { status: "unknown", textureRotated: dimsRotated, dimsRotated, samples, note: "표본 색 판별 실패 — 크기 비교로 대체" };
  } finally {
    v.removeAttribute("src");
    v.load();
    URL.revokeObjectURL(url);
  }
}

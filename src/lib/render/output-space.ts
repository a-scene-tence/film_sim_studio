// Step 5 §3 화면 출력 색공간: sRGB(기본) / Display P3.
// 렌더 결과는 sRGB 원색의 sRGB 인코딩 값이다. P3 캔버스에는 같은 색을 P3 원색으로 다시 표현해 쓴다
// (선형 sRGB → 선형 P3 행렬, 전달함수는 sRGB 와 동일 — docs/COLOR_SCIENCE.md §3 원색표). 색 자체는 바꾸지 않는다.
import { matrixToWS } from "../color/source/primaries.mjs";
import { colMajor, inv3, type Mat3 } from "./wb";

export type OutputSpace = "srgb" | "display-p3";
export const OUTPUT_SPACES: ReadonlyArray<OutputSpace> = ["srgb", "display-p3"];
export const OUTPUT_SPACE_KEY = "filmlab.outputSpace";

export function parseOutputSpace(v: unknown): OutputSpace {
  return v === "display-p3" ? "display-p3" : "srgb";
}

/** 선형 sRGB → 선형 Display P3 (M_P3→709 의 역행렬) */
export function srgbToP3Matrix(): Mat3 {
  return inv3(matrixToWS("display-p3") as Mat3);
}

/** GLSL uniform mat3 (열 우선) */
let uniformCache: Float32Array | null = null;
export function srgbToP3Uniform(): Float32Array {
  return (uniformCache ??= colMajor(srgbToP3Matrix()));
}

interface P3Env {
  matchMedia?: (q: string) => { matches: boolean };
}

/** 화면이 P3 색역을 표시하는가 — matchMedia('(color-gamut: p3)') */
export function displayIsP3(env: P3Env | undefined = typeof window === "undefined" ? undefined : (window as unknown as P3Env)): boolean {
  try {
    return !!env?.matchMedia?.("(color-gamut: p3)").matches;
  } catch {
    return false;
  }
}

/** WebGL2 드로잉 버퍼가 'display-p3' 를 받아들이는가 (속성이 있고 값을 바꿀 수 있어야 한다) */
export function glSupportsP3(gl: { drawingBufferColorSpace?: string } | null | undefined): boolean {
  if (!gl || !("drawingBufferColorSpace" in gl)) return false;
  const prev = gl.drawingBufferColorSpace;
  try {
    gl.drawingBufferColorSpace = "display-p3";
    const ok = gl.drawingBufferColorSpace === "display-p3";
    gl.drawingBufferColorSpace = prev ?? "srgb";
    return ok;
  } catch {
    return false;
  }
}

/** 두 조건이 모두 참일 때만 전환 UI 를 보인다 */
export function p3Available(gl: { drawingBufferColorSpace?: string } | null | undefined, env?: P3Env): boolean {
  return displayIsP3(env) && glSupportsP3(gl);
}

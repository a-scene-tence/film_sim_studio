// 섹션 4.2 GPU 규약 — WebGL2 컨텍스트·확장·프로그램·렌더 타깃 풀.
import { assembleFragment, VS_GLSL, type PassName } from "./glsl";

export type RenderErrorCode =
  | "UNSUPPORTED_WEBGL2" | "UNSUPPORTED_FLOAT_RENDER" | "SHADER_COMPILE_FAILED" | "STALE_PREVIEW_CHAIN"
  | "PQ_UNSUPPORTED" | "NO_SOURCE" | "LUT_LOAD_FAILED" | "CONTEXT_LOST" | "TILE_TOO_LARGE";

/** 사용자 대면 문구는 한국어, 원인과 해결 방법을 함께 적는다 (CLAUDE.md §7). */
export class RenderError extends Error {
  readonly code: RenderErrorCode;
  constructor(code: RenderErrorCode, message: string) {
    super(message);
    this.name = "RenderError";
    this.code = code;
  }
}

export const renderErrors = {
  noWebgl2: () => new RenderError("UNSUPPORTED_WEBGL2", "이 브라우저는 WebGL2 를 지원하지 않습니다 — iOS Safari 16.4 이상 또는 Android Chrome 120 이상에서 열어 주세요."),
  noFloat: () => new RenderError("UNSUPPORTED_FLOAT_RENDER", "이 기기 GPU 는 16bit 부동소수 렌더 타깃(EXT_color_buffer_float / half_float)을 지원하지 않아 정확한 색 처리를 할 수 없습니다 — 다른 기기나 최신 브라우저에서 열어 주세요."),
  shader: (name: string, log: string) => new RenderError("SHADER_COMPILE_FAILED", `셰이더(${name}) 컴파일·링크 실패 — GPU 드라이버 호환 문제입니다. 브라우저를 최신으로 업데이트하세요.\n${log}`),
  stale: () => new RenderError("STALE_PREVIEW_CHAIN", "미리보기 렌더가 현재 파라미터와 다릅니다 — 미리보기를 다시 그린 뒤(renderNow) 저장하세요."),
  pq: () => new RenderError("PQ_UNSUPPORTED", "HDR10(PQ) 영상은 지원하지 않습니다 — HLG 또는 SDR 로 다시 내보낸 영상을 여세요."),
  noSource: () => new RenderError("NO_SOURCE", "렌더할 사진이나 영상이 없습니다 — 파일을 먼저 여세요."),
  lut: (detail: string) => new RenderError("LUT_LOAD_FAILED", `필름 LUT 를 불러오지 못했습니다 (${detail}) — 네트워크 연결 또는 오프라인 캐시를 확인하고 새로고침하세요.`),
  lost: () => new RenderError("CONTEXT_LOST", "GPU 컨텍스트가 손실되었습니다 — 잠시 후 자동으로 복구됩니다. 계속되면 페이지를 새로고침하세요."),
  tileTooLarge: () => new RenderError("TILE_TOO_LARGE", "타일 요청이 최대 크기(1024×1024 + 패딩, 소스 2048×2048)를 넘습니다 — 더 작은 타일로 나눠 요청하세요."),
};

export const renderWarnings = {
  halfFloat: "EXT_color_buffer_float 미지원 — EXT_color_buffer_half_float 로 렌더하며 가이드 필터 중간값을 RG16F 로 저장합니다(정밀도 저하)",
  sourceLutRequired: "SOURCE_TRANSFORM_LUT_REQUIRED: 공식 변환 LUT 등록이 필요합니다 — /lab/luts 에서 등록. 지금은 Rec.709 로 표시합니다",
  rotationUnsupported: "ROTATION_UNSUPPORTED: 90° 단위가 아닌 회전 행렬입니다 — 방향 1 로 표시합니다",
  orientationProbeUnknown: "ORIENTATION_PROBE_UNKNOWN: 브라우저 업로드 방향 판별 실패 — 크기 비교로 대체했습니다",
};

export interface RendererCaps {
  floatRender: "full" | "half";
  rg32fRenderable: boolean;
  videoHalfFloatUpload: boolean | null;
  maxTextureSize: number;
  max3DTextureSize: number;
}

export type Fmt = "rgba16f" | "rg32f" | "rg16f" | "r16f" | "rgba8";

export interface Target { tex: WebGLTexture; fbo: WebGLFramebuffer; width: number; height: number; fmt: Fmt }

export interface Sized { width: number; height: number }

/** 섹션 4.2-1 컨텍스트 */
export function createContext(canvas: HTMLCanvasElement, opts: { preserveDrawingBuffer?: boolean } = {}): WebGL2RenderingContext {
  const gl = canvas.getContext("webgl2", {
    alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: opts.preserveDrawingBuffer === true, powerPreference: "high-performance",
  });
  if (!gl) throw renderErrors.noWebgl2();
  return gl;
}

/** 섹션 4.2-2 확장 */
export function detectCaps(gl: WebGL2RenderingContext, warnings: string[]): RendererCaps {
  let floatRender: "full" | "half";
  if (gl.getExtension("EXT_color_buffer_float")) floatRender = "full";
  else if (gl.getExtension("EXT_color_buffer_half_float")) { floatRender = "half"; warnings.push(renderWarnings.halfFloat); }
  else throw renderErrors.noFloat();
  return {
    floatRender,
    rg32fRenderable: floatRender === "full",
    videoHalfFloatUpload: null,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    max3DTextureSize: gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) as number,
  };
}

/** 섹션 4.2-4 업로드 공통 상태 */
export function setUnpackState(gl: WebGL2RenderingContext): void {
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
}

interface FmtSpec { internal: number; format: number; type: number; filter: number }

export function fmtSpec(gl: WebGL2RenderingContext, fmt: Fmt, caps: RendererCaps): FmtSpec {
  switch (fmt) {
    case "rgba16f": return { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, filter: gl.LINEAR };
    case "rg32f": return caps.rg32fRenderable
      ? { internal: gl.RG32F, format: gl.RG, type: gl.FLOAT, filter: gl.NEAREST }
      : { internal: gl.RG16F, format: gl.RG, type: gl.HALF_FLOAT, filter: gl.NEAREST };
    case "rg16f": return { internal: gl.RG16F, format: gl.RG, type: gl.HALF_FLOAT, filter: gl.LINEAR };
    case "r16f": return { internal: gl.R16F, format: gl.RED, type: gl.HALF_FLOAT, filter: gl.LINEAR };
    case "rgba8": return { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR };
  }
}

export function texParams(gl: WebGL2RenderingContext, target: number, filter: number): void {
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (target === gl.TEXTURE_3D) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
}

/** 2D 텍스처 (Float32/Uint8 업로드 또는 빈 텍스처) */
export function createTex2D(gl: WebGL2RenderingContext, w: number, h: number, internal: number, format: number, type: number, filter: number, data: ArrayBufferView | null): WebGLTexture {
  const t = gl.createTexture();
  if (!t) throw renderErrors.lost();
  gl.bindTexture(gl.TEXTURE_2D, t);
  texParams(gl, gl.TEXTURE_2D, filter);
  setUnpackState(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
  return t;
}

/** 섹션 4.2-6 3D LUT: RGB16F ← Float32, NEAREST (texelFetch 전용). x=r, y=g, z=b */
export function createLut3D(gl: WebGL2RenderingContext, N: number, rgb: Float32Array): WebGLTexture {
  const t = gl.createTexture();
  if (!t) throw renderErrors.lost();
  gl.bindTexture(gl.TEXTURE_3D, t);
  texParams(gl, gl.TEXTURE_3D, gl.NEAREST);
  setUnpackState(gl);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, N, N, N, 0, gl.RGB, gl.FLOAT, rgb);
  return t;
}

/** (크기, 형식) 키 렌더 타깃 풀 */
export class TargetPool {
  private free = new Map<string, Target[]>();
  private all = new Set<Target>();
  constructor(private gl: WebGL2RenderingContext, private caps: RendererCaps) {}

  acquire(w: number, h: number, fmt: Fmt): Target {
    const key = `${w}x${h}:${fmt}`;
    const list = this.free.get(key);
    const hit = list?.pop();
    if (hit) return hit;
    const gl = this.gl;
    const s = fmtSpec(gl, fmt, this.caps);
    const tex = createTex2D(gl, w, h, s.internal, s.format, s.type, s.filter, null);
    const fbo = gl.createFramebuffer();
    if (!fbo) throw renderErrors.lost();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (st !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      throw renderErrors.noFloat();
    }
    const t: Target = { tex, fbo, width: w, height: h, fmt };
    this.all.add(t);
    return t;
  }

  release(t: Target | null | undefined): void {
    if (!t || !this.all.has(t)) return;
    const key = `${t.width}x${t.height}:${t.fmt}`;
    const list = this.free.get(key) ?? [];
    if (!list.includes(t)) list.push(t);
    this.free.set(key, list);
  }

  /** 사용 중이 아닌(free) 타깃만 삭제한다 — 크기가 매번 다른 타일 렌더 후 GPU 메모리 회수 */
  deleteFree(): void {
    for (const list of this.free.values()) {
      for (const t of list) { this.gl.deleteFramebuffer(t.fbo); this.gl.deleteTexture(t.tex); this.all.delete(t); }
    }
    this.free.clear();
  }

  /** 소스나 R 이 바뀌면 전부 해제 */
  clear(): void {
    for (const t of this.all) { this.gl.deleteFramebuffer(t.fbo); this.gl.deleteTexture(t.tex); }
    this.all.clear();
    this.free.clear();
  }

  /** 컨텍스트 손실 후: GL 객체는 이미 무효이므로 참조만 버린다 */
  forget(): void {
    this.all.clear();
    this.free.clear();
  }
}

export interface SamplerInfo { unit: number; kind: "2d" | "3d" }

/** 링크된 프로그램 + 유니폼 위치 캐시 + 샘플러 고정 텍스처 유닛 */
export class Program {
  readonly locs = new Map<string, WebGLUniformLocation | null>();
  readonly samplers = new Map<string, SamplerInfo>();
  constructor(readonly gl: WebGL2RenderingContext, readonly name: string, readonly prog: WebGLProgram) {
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
    gl.useProgram(prog);
    let unit = 0;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i);
      if (!info) continue;
      const kind = info.type === gl.SAMPLER_2D ? "2d" : info.type === gl.SAMPLER_3D ? "3d" : null;
      if (!kind) continue;
      const loc = gl.getUniformLocation(prog, info.name);
      // 서로 다른 형식의 샘플러가 같은 유닛을 가리키지 않도록 고정 유닛을 하나씩 배정한다
      gl.uniform1i(loc, unit);
      this.samplers.set(info.name, { unit, kind });
      unit++;
    }
  }
  loc(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name);
    if (l === undefined) { l = this.gl.getUniformLocation(this.prog, name); this.locs.set(name, l); }
    return l;
  }
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string, name: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw renderErrors.lost();
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(s) ?? "";
    gl.deleteShader(s);
    throw renderErrors.shader(name, log);
  }
  return s;
}

/** 섹션 4.2-8 셰이더 조립 + 컴파일·링크 */
export function buildProgram(gl: WebGL2RenderingContext, pass: PassName): Program {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VS_GLSL, "vs");
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, assembleFragment(pass), `fs_${pass}`);
  const p = gl.createProgram();
  if (!p) throw renderErrors.lost();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(p) ?? "";
    gl.deleteProgram(p);
    throw renderErrors.shader(`fs_${pass}`, log);
  }
  return new Program(gl, pass, p);
}

/** 반정밀도 → 단정밀도 */
export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

/** float 렌더 타깃(RGBA16F) 판독. FLOAT 판독이 막힌 기기는 HALF_FLOAT 로 읽어 변환한다. 판독 후 FBO 바인딩은 반드시 기본 프레임버퍼(null)·캔버스 뷰포트로 복구한다 */
export function readFloatRGBA(gl: WebGL2RenderingContext, t: Target, x = 0, y = 0, w = t.width, h = t.height): Float32Array {
  try {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    const type = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE) as number;
    const fmt = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT) as number;
    if (type === gl.HALF_FLOAT && fmt === gl.RGBA) {
      const u = new Uint16Array(w * h * 4);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.HALF_FLOAT, u);
      return Float32Array.from(u, halfToFloat);
    }
    const out = new Float32Array(w * h * 4);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, out);
    return out;
  } finally {
    restoreDefaultFramebuffer(gl);
  }
}

/** 오프스크린 패스 이후 상태 복구: 기본 프레임버퍼 + 캔버스 전체 뷰포트 */
export function restoreDefaultFramebuffer(gl: WebGL2RenderingContext): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
}

// docs/RENDERER.md 섹션 6 fs_final.glsl 정본. Step 5 에서 화면 출력 색공간 변환(uOutConv, 기본 false = 정본과 동일), FSE-v2 §5-7-8 광학 윤곽 완화(uIspEs)만 추가했다.
import { GRAIN_CLUSTER_MIX, GRAIN_CLUSTER_STD, GRAIN_FINE_STD, GRAIN_FLOOR, GRAIN_GAIN, GRAIN_TRI_NORM, GRAIN_W_CENTER, GRAIN_W_NEIGHBOR } from "../grain";
const f = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
export const FS_FINAL_GLSL = `// ===== fs_final : S12 sharpen + optical edge softening, S13 grain, S14 dither, output =====
uniform sampler2D uPost;
uniform sampler2D uBlurL;
uniform float uSharpen;      // 0..150
uniform float uIspEs;        // optical edge softening = brand ISP es x film strength x processed-source x render scale
uniform float uGrainAmt;     // 0..100
uniform float uGrainScale;   // px per grain cell (>= 1)
uniform vec2 uGrainOff;
uniform float uGrainCoarse; // 0..1 : 3x3 클러스터 중첩 비율 (크기 소 = 0, 대 = 1)
uniform bool uDither;
uniform bool uFlipY;         // true only when writing to the default framebuffer
uniform vec2 uCropOrigin;    // texel offset of the written region inside uPost (tile padding)
uniform vec2 uImgPxOrigin;   // global image pixel coordinate of the written region origin
uniform bool uOutConv;       // Step 5: true 면 화면 출력을 sRGB 원색 → uOutM(Display P3) 으로 변환 (기본 false)
uniform mat3 uOutM;
out vec4 outColor;
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
float cellTri(ivec2 c, uint seed) {
  uvec3 h = pcg3d(uvec3(uvec2(c), seed));
  return (float(h.x) / 4294967296.0 + float(h.y) / 4294967296.0 - 1.0) * ${f(GRAIN_TRI_NORM)};
}
float fineGrain(ivec2 c) {
  float s = ${f(GRAIN_W_CENTER)} * cellTri(c, 0u)
    + ${f(GRAIN_W_NEIGHBOR)} * (cellTri(c + ivec2(-1, 0), 0u) + cellTri(c + ivec2(1, 0), 0u) + cellTri(c + ivec2(0, -1), 0u) + cellTri(c + ivec2(0, 1), 0u));
  return s / ${f(GRAIN_FINE_STD)};
}
float clusterGrain(ivec2 c) {
  float s = 0.0;
  for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) s += float((2 - abs(dx)) * (2 - abs(dy))) * cellTri(c + ivec2(dx, dy), 1u);
  return s / 16.0 / ${f(GRAIN_CLUSTER_STD)};
}
void main() {
  ivec2 o = ivec2(gl_FragCoord.xy);
  if (uFlipY) o.y = int(uDstSize.y) - 1 - o.y;
  ivec2 p = o + ivec2(uCropOrigin);
  vec4 t = texelFetch(uPost, p, 0);
  vec3 v = t.rgb;
  if (uSharpen > 0.0 || uIspEs > 0.0) {
    float D = t.a - texelFetch(uBlurL, p, 0).r;
    float Dp = sign(D) * max(abs(D) - 0.004, 0.0);
    vec3 lab = linToOklab(srgbDec(v));
    lab.x = t.a + (uSharpen / 100.0) * 1.2 * Dp - uIspEs * sstep(0.012, 0.045, abs(D)) * D;
    v = srgbEnc(gamutMap(lab));
  }
  vec2 px = uImgPxOrigin + vec2(o) + 0.5;
  if (uGrainAmt > 0.0) {
    ivec2 gc = ivec2(floor(px / uGrainScale + uGrainOff));
    float n = fineGrain(gc);
    if (uGrainCoarse > 0.0) {
      float wc = ${f(GRAIN_CLUSTER_MIX)} * uGrainCoarse, wf = 1.0 - wc;
      n = (wf * n + wc * clusterGrain(gc)) / sqrt(wf * wf + wc * wc);
    }
    float vl = dot(LUMA, v);
    float resp = ${f(GRAIN_FLOOR)} + (1.0 - ${f(GRAIN_FLOOR)}) * max(4.0 * vl * (1.0 - vl), 0.0);
    v = clamp(v + ${f(GRAIN_GAIN)} * (uGrainAmt / 100.0) * resp * n, 0.0, 1.0);
  }
  if (uOutConv) v = srgbEnc(clamp(uOutM * srgbDec(v), 0.0, 1.0));
  if (uDither) {
    uvec2 ip = uvec2(px);
    float n1 = float(pcg3d(uvec3(ip, 0u)).x) / 4294967296.0;
    float n2 = float(pcg3d(uvec3(ip, 1u)).x) / 4294967296.0;
    v = floor(clamp(v + (n1 + n2 - 1.0) / 255.0, 0.0, 1.0) * 255.0 + 0.5) / 255.0;
  }
  outColor = vec4(v, 1.0);
}
`;

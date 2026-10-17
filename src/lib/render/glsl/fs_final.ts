// docs/RENDERER.md 섹션 6 fs_final.glsl 정본. Step 5 에서 화면 출력 색공간 변환(uOutConv, 기본 false = 정본과 동일), FSE-v2 §5-7-8 광학 윤곽 완화(uIspEs)만 추가했다.
import { GRAIN_CELL } from "../grain";
export const FS_FINAL_GLSL = `// ===== fs_final : S12 sharpen + optical edge softening, S13 grain, S14 dither, output =====
uniform sampler2D uPost;
uniform sampler2D uBlurL;
uniform float uSharpen;      // 0..150
uniform float uIspEs;        // optical edge softening = brand ISP es x film strength x processed-source x render scale
uniform float uGrainAmt;     // 0..100
uniform float uGrainScale;   // px per noise unit
uniform vec2 uGrainOff;
uniform float uGrainCoarse; // 0..1 : 큰 입자 옥타브 가중치 (그레인 크기 슬라이더에서 유도)
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
float latticeHash(ivec2 c, uint seed) { return float(pcg3d(uvec3(uvec2(c), seed)).x) / 4294967296.0 * 2.0 - 1.0; }
float valueNoise(vec2 q, uint seed) {
  vec2 f = floor(q);
  vec2 t = q - f;
  t = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
  ivec2 c = ivec2(f);
  float a = latticeHash(c, seed), b = latticeHash(c + ivec2(1, 0), seed);
  float cc = latticeHash(c + ivec2(0, 1), seed), d = latticeHash(c + ivec2(1, 1), seed);
  return a + (b - a) * t.x + (cc - a) * t.y + (a - b - cc + d) * t.x * t.y;
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
    vec2 q = px / (uGrainScale * ${GRAIN_CELL}) + uGrainOff;
    float n = 1.25 * (0.62 * valueNoise(q, 0u) + 0.26 * valueNoise(q * 2.03 + vec2(17.13, 41.71), 1u) + 0.5 * uGrainCoarse * valueNoise(q * 0.5 + vec2(29.3, 5.9), 2u)) * (0.65 + 0.35 * valueNoise(q * 0.37 + vec2(3.7, 9.1), 3u));
    float vl = dot(LUMA, v);
    float resp = 0.4 + 0.6 * sqrt(max(4.0 * vl * (1.0 - vl), 0.0));
    v = clamp(v + 0.205 * (uGrainAmt / 100.0) * resp * n, 0.0, 1.0);
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

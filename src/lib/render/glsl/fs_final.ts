// docs/RENDERER.md 섹션 6 fs_final.glsl 정본. Step 5 에서 화면 출력 색공간 변환(uOutConv, 기본 false = 정본과 동일)만 추가했다.
export const FS_FINAL_GLSL = `// ===== fs_final : S12 sharpen, S13 grain, S14 dither, output =====
uniform sampler2D uPost;
uniform sampler2D uBlurL;
uniform float uSharpen;      // 0..150
uniform float uGrainAmt;     // 0..100
uniform float uGrainScale;   // px per noise unit
uniform vec2 uGrainOff;
uniform bool uDither;
uniform bool uFlipY;         // true only when writing to the default framebuffer
uniform vec2 uCropOrigin;    // texel offset of the written region inside uPost (tile padding)
uniform vec2 uImgPxOrigin;   // global image pixel coordinate of the written region origin
uniform bool uOutConv;       // Step 5: true 면 화면 출력을 sRGB 원색 → uOutM(Display P3) 으로 변환 (기본 false)
uniform mat3 uOutM;
out vec4 outColor;
vec3 mod289v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289v2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289v3(((x * 34.0) + 10.0) * x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289v2(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
void main() {
  ivec2 o = ivec2(gl_FragCoord.xy);
  if (uFlipY) o.y = int(uDstSize.y) - 1 - o.y;
  ivec2 p = o + ivec2(uCropOrigin);
  vec4 t = texelFetch(uPost, p, 0);
  vec3 v = t.rgb;
  if (uSharpen > 0.0) {
    float D = t.a - texelFetch(uBlurL, p, 0).r;
    float Dp = sign(D) * max(abs(D) - 0.004, 0.0);
    vec3 lab = linToOklab(srgbDec(v));
    lab.x = t.a + (uSharpen / 100.0) * 1.2 * Dp;
    v = srgbEnc(gamutMap(lab));
  }
  vec2 px = uImgPxOrigin + vec2(o) + 0.5;
  if (uGrainAmt > 0.0) {
    vec2 q = px / uGrainScale + uGrainOff;
    float n = (0.72 * snoise(q) + 0.28 * snoise(q * 2.03 + vec2(17.13, 41.71))) * (0.65 + 0.35 * snoise(q * 0.37 + vec2(3.7, 9.1)));
    float vl = dot(LUMA, v);
    float resp = sqrt(max(4.0 * vl * (1.0 - vl), 0.0));
    v = clamp(v + 0.07 * (uGrainAmt / 100.0) * resp * n, 0.0, 1.0);
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

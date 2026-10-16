// docs/RENDERER.md 섹션 6 common.glsl — 글자 그대로 옮긴 정본. 수정 금지.
export const COMMON_GLSL = `// ===== common.glsl (FSE-v1 Step 3) =====
const float DEG = 0.017453292519943295;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float TREF_A = 1.3;
const float TREF_AD = 1.196;
const float TREF_B = 0.884006171;
const float TREF_C = 0.452670345;
const float TREF_HDR = 2.04;
const float SH_C = 0.00140625;
const float SH_L = 13.474057982;
float sq(float x) { return x * x; }
float sstep(float e0, float e1, float x) { float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float wrap180(float t) { return mod(t + 180.0, 360.0) - 180.0; }
float cbrtS(float x) { return sign(x) * pow(abs(x), 1.0 / 3.0); }
float srgbEnc1(float y) { return y <= 0.0031308 ? 12.92 * y : 1.055 * pow(y, 1.0 / 2.4) - 0.055; }
float srgbDec1(float v) { return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }
vec3 srgbEnc(vec3 y) { return vec3(srgbEnc1(y.r), srgbEnc1(y.g), srgbEnc1(y.b)); }
vec3 srgbDec(vec3 v) { return vec3(srgbDec1(v.r), srgbDec1(v.g), srgbDec1(v.b)); }
float toneRef(float x) {
  if (x <= 0.0) return 0.0;
  if (x >= TREF_HDR) return 1.0;
  return min(1.0, pow(x, TREF_A) / (pow(x, TREF_AD) * TREF_B + TREF_C));
}
float shaperEnc1(float x) { return log2((max(x, 0.0) + SH_C) / SH_C) / SH_L; }
vec3 linToOklab(vec3 c) {
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  float l_ = cbrtS(l); float m_ = cbrtS(m); float s_ = cbrtS(s);
  return vec3(0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
              1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
              0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_);
}
vec3 oklabToLin(vec3 lab) {
  float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  float l = l_ * l_ * l_; float m = m_ * m_ * m_; float s = s_ * s_ * s_;
  return vec3( 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
              -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
              -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}
bool inGamut(vec3 c) { return all(greaterThanEqual(c, vec3(-1e-5))) && all(lessThanEqual(c, vec3(1.0 + 1e-5))); }
vec3 gamutMap(vec3 lab) {
  float L = clamp(lab.x, 0.0, 1.0);
  float C = length(lab.yz);
  if (C < 1e-9) return clamp(oklabToLin(vec3(L, 0.0, 0.0)), 0.0, 1.0);
  vec2 dir = lab.yz / C;
  float lo = 0.0; float hi = 0.5;
  for (int i = 0; i < 16; i++) {
    float m = 0.5 * (lo + hi);
    if (inGamut(oklabToLin(vec3(L, dir * m)))) lo = m; else hi = m;
  }
  float t = 0.85 * lo; float Co = C;
  if (C > t) { float r = lo - t; Co = r > 1e-9 ? t + r * tanh((C - t) / r) : t; }
  return clamp(oklabToLin(vec3(L, dir * Co)), 0.0, 1.0);
}
vec3 lutTetra(sampler3D lut, int N, vec3 u) {
  vec3 p = clamp(u, 0.0, 1.0) * float(N - 1);
  ivec3 i = min(ivec3(floor(p)), ivec3(N - 2));
  vec3 f = p - vec3(i);
  vec3 c000 = texelFetch(lut, i, 0).rgb;
  vec3 c111 = texelFetch(lut, i + ivec3(1, 1, 1), 0).rgb;
  vec3 A; vec3 B; vec4 w;
  if (f.r > f.g) {
    if (f.g > f.b)      { A = texelFetch(lut, i + ivec3(1,0,0), 0).rgb; B = texelFetch(lut, i + ivec3(1,1,0), 0).rgb; w = vec4(1.0 - f.r, f.r - f.g, f.g - f.b, f.b); }
    else if (f.r > f.b) { A = texelFetch(lut, i + ivec3(1,0,0), 0).rgb; B = texelFetch(lut, i + ivec3(1,0,1), 0).rgb; w = vec4(1.0 - f.r, f.r - f.b, f.b - f.g, f.g); }
    else                { A = texelFetch(lut, i + ivec3(0,0,1), 0).rgb; B = texelFetch(lut, i + ivec3(1,0,1), 0).rgb; w = vec4(1.0 - f.b, f.b - f.r, f.r - f.g, f.g); }
  } else {
    if (f.b > f.g)      { A = texelFetch(lut, i + ivec3(0,0,1), 0).rgb; B = texelFetch(lut, i + ivec3(0,1,1), 0).rgb; w = vec4(1.0 - f.b, f.b - f.g, f.g - f.r, f.r); }
    else if (f.b > f.r) { A = texelFetch(lut, i + ivec3(0,1,0), 0).rgb; B = texelFetch(lut, i + ivec3(0,1,1), 0).rgb; w = vec4(1.0 - f.g, f.g - f.b, f.b - f.r, f.r); }
    else                { A = texelFetch(lut, i + ivec3(0,1,0), 0).rgb; B = texelFetch(lut, i + ivec3(1,1,0), 0).rgb; w = vec4(1.0 - f.g, f.g - f.r, f.r - f.b, f.b); }
  }
  return w.x * c000 + w.y * A + w.z * B + w.w * c111;
}
// orientation mapping: display uv -> stored uv (EXIF 1..8)
vec2 orientUv(vec2 uv, int o) {
  if (o == 2) return vec2(1.0 - uv.x, uv.y);
  if (o == 3) return vec2(1.0 - uv.x, 1.0 - uv.y);
  if (o == 4) return vec2(uv.x, 1.0 - uv.y);
  if (o == 5) return vec2(uv.y, uv.x);
  if (o == 6) return vec2(uv.y, 1.0 - uv.x);
  if (o == 7) return vec2(1.0 - uv.y, 1.0 - uv.x);
  if (o == 8) return vec2(1.0 - uv.y, uv.x);
  return uv;
}
`;

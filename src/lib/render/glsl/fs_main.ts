// docs/RENDERER.md 섹션 6 fs_main.glsl — 정본. Step 4 §5-3 패치(uFilmStrength, lutRaw/lutStage)만 허용.
export const FS_MAIN_GLSL = `// ===== fs_main : S1~S7 (HDF, dehaze, base tone, contrast, vignette, clip, film LUT) =====
uniform sampler2D uWS;
uniform bool uToneOps;
uniform sampler2D uToneAB;   // RG (mean_a, mean_b), global uv
uniform float uSh; uniform float uHi; uniform float uWh; uniform float uBk; uniform float uBr; uniform float uLb; // each -1..1
uniform float uCt;           // -1..1
uniform float uVig;          // -100..100
uniform int uLutMode;        // 0 none(T_ref), 1 built-in FSE LUT, 2 external look LUT
uniform sampler3D uLut;
uniform int uLutN;
uniform int uLutDomain;      // 0 srgb-display, 1 rec709-bt1886, 2 fsh-v1, 3 slog3-sgamut3cine
uniform bool uLutInVR;
uniform bool uLutOutVR;
uniform vec3 uLutDomMin;
uniform vec3 uLutDomMax;
uniform mat3 uWsToSG3C;
uniform float uFilmStrength; // 0..1 (UI 0..100 %, default 1)
out vec4 outColor;
vec3 baseTone(vec3 x, vec2 uvG) {
  float Y = dot(LUMA, x);
  if (Y <= exp2(-20.0)) return x;
  float Yl = log2(Y);
  vec2 ab = texture(uToneAB, uvG).rg;
  float Bs = ab.x * Yl + ab.y;
  float Dt = Yl - Bs;
  float e = Bs - log2(0.18);
  float msh = exp(-0.5 * sq((e + 3.0) / 1.5));
  float mhi = sstep(-0.5, 2.5, e);
  float mwh = sstep(1.5, 3.8, e);
  float mbk = 1.0 - sstep(-7.0, -3.0, e);
  float mmid = exp(-0.5 * sq(e / 1.8));
  float dB = 1.5 * uSh * msh + 1.5 * uHi * mhi + 1.0 * uWh * mwh + 1.0 * uBk * mbk + 1.0 * uBr * mmid + 1.2 * uLb * (msh - mhi);
  float Yp = exp2(Bs + dB + Dt);
  return x * (Yp / Y);
}
vec3 contrastOp(vec3 x) {
  float Y = dot(LUMA, x);
  if (Y <= exp2(-20.0)) return x;
  float e = log2(Y) - log2(0.18);
  float Yp = 0.18 * exp2(e * (1.0 + 0.5 * uCt));
  return x * (Yp / Y);
}
float vignetteF(vec2 uvG) {
  float aspect = uImageSize.x / uImageSize.y;
  vec2 p = (uvG - 0.5) * vec2(aspect, 1.0);
  float r = length(p) / length(vec2(aspect, 1.0) * 0.5);
  float k = abs(uVig) / 100.0;
  float q = 1.0 + (r * k) * (r * k);
  float f = 1.0 / (q * q);
  return uVig < 0.0 ? f : 1.0 / f;
}
vec3 clipNeg(vec3 x) {
  float n = min(x.r, min(x.g, x.b));
  if (n >= 0.0) return x;
  float Y = dot(LUMA, x);
  if (Y <= 0.0) return vec3(0.0);
  float t = Y / (Y - n);
  return vec3(Y) + t * (x - vec3(Y));
}
float slog3Enc(float x) { return x >= 0.01125 ? (420.0 + log2((x + 0.01) / 0.19) * 0.30102999566398 * 261.5) / 1023.0 : (x * (171.2102946929 - 95.0) / 0.01125 + 95.0) / 1023.0; }
vec3 toneRef3(vec3 x) { return vec3(toneRef(x.r), toneRef(x.g), toneRef(x.b)); }
vec3 lutRaw(vec3 x) {
  if (uLutMode == 1) return lutTetra(uLut, uLutN, vec3(shaperEnc1(x.r), shaperEnc1(x.g), shaperEnc1(x.b)));
  vec3 u;
  if (uLutDomain == 0) u = srgbEnc(toneRef3(x));
  else if (uLutDomain == 1) u = pow(toneRef3(x), vec3(1.0 / 2.4));
  else if (uLutDomain == 2) u = vec3(shaperEnc1(x.r), shaperEnc1(x.g), shaperEnc1(x.b));
  else { vec3 xs = uWsToSG3C * x; u = vec3(slog3Enc(xs.r), slog3Enc(xs.g), slog3Enc(xs.b)); }
  if (uLutInVR) u = u * (876.0 / 1023.0) + 64.0 / 1023.0;
  u = (u - uLutDomMin) / (uLutDomMax - uLutDomMin);
  vec3 o = lutTetra(uLut, uLutN, u);
  if (uLutOutVR) o = (o * 1023.0 - 64.0) / 876.0;
  return clamp(o, 0.0, 1.0);
}
vec3 lutStage(vec3 x) {
  vec3 vNone = srgbEnc(toneRef3(x));
  if (uLutMode == 0) return vNone;
  vec3 vSim = lutRaw(x);
  if (uFilmStrength >= 1.0) return vSim;
  return srgbEnc(mix(srgbDec(vNone), srgbDec(vSim), clamp(uFilmStrength, 0.0, 1.0)));
}
void main() {
  vec2 uvL = uvLocal();
  vec2 uvG = uvGlobal();
  vec3 x = texelFetch(uWS, ivec2(gl_FragCoord.xy), 0).rgb;
  x = hdfComposite(x, uvL, uvG);
  x = dehazeApply(x, uvG);
  if (uToneOps) x = baseTone(x, uvG);
  if (uCt != 0.0) x = contrastOp(x);
  if (uVig != 0.0) x *= vignetteF(uvG);
  x = clipNeg(x);
  outColor = vec4(lutStage(x), 1.0);
}
`;

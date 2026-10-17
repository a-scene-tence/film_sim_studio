// docs/RENDERER.md 섹션 6 fs_main.glsl — 정본. Step 4 §5-3 패치(uFilmStrength, lutRaw/lutStage), FSE-v2 §5-7-3~6 패치(ISP: ZS·팝, filmShoulder, hdOp, mhComposite), OPT-v1 패치(존 분리 베이스 톤, 시그모이드 대비, COLOR_SCIENCE §8.4·§8.5)만 허용.
export const FS_MAIN_GLSL = `// ===== fs_main : S1~S7b (HDF, micro-halation, dehaze, base tone, contrast, vignette, clip, film shoulder, film LUT, highlight density) =====
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
uniform float uIspSd;        // zone I-II shadow density (stops) = brand ISP sd x film strength
uniform float uIspPop;       // zone III-IV micro-contrast gain = brand ISP pop x film strength
uniform float uIspHd;        // highlight density = brand ISP hd x film strength
uniform float uDrStops;      // 0, 1, 2 (DR100 / DR200 / DR400)
uniform bool uSceneRef;      // true when the source has highlight headroom (RAW, Log, HLG)
uniform float uDrY0;         // display-referred DR shoulder knee (scene Y), unused when uDrS = 0
uniform float uDrS;          // display-referred DR shoulder softness (0 = off)
const float ISP_YK = 0.328679008;  // scene Y whose T_ref display L = 0.70
const float ISP_UO = 2.63381793;   // log2(2.04 / ISP_YK)
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
  float msd = exp(-0.5 * sq((e + 3.5) / 1.0));
  float mz = exp(-0.5 * sq((e + 1.5) / 1.2));
  float msh2 = msh * (uSh > 0.0 ? sstep(-7.0, -4.0, e) : 1.0) * (1.0 - sstep(-3.5, 1.5, e));
  float mhi2 = uHi < 0.0 ? sstep(-1.0, 3.5, e) : mhi;
  float dB = 1.5 * uSh * msh2 + 1.5 * uHi * mhi2 + 1.0 * uWh * mwh + 1.0 * uBk * mbk + 1.0 * uBr * mmid + 1.2 * uLb * (msh - mhi) - uIspSd * msd;
  float Dt2 = Dt + uIspPop * mz * Dt / (1.0 + sq(Dt / 0.6));
  float dg = 1.0 + 0.25 * (max(uSh, 0.0) * msh2 + max(-uHi, 0.0) * mhi2);
  float Yp = exp2(Bs + dB + Dt2 * dg);
  return x * (Yp / Y);
}
vec3 contrastOp(vec3 x) {
  float Y = dot(LUMA, x);
  if (Y <= exp2(-20.0)) return x;
  float e = log2(Y) - log2(0.18);
  float Yp = 0.18 * exp2(e + 0.5 * uCt * e * exp(-0.5 * sq(e / 2.5)));
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
vec3 filmShoulder(vec3 x) {
  if (uDrStops <= 0.0) return x;
  float Y = dot(LUMA, max(x, 0.0));
  if (Y <= ISP_YK) return x;
  float Ui = uSceneRef ? ISP_UO + uDrStops : ISP_UO;
  float u = log2(Y / ISP_YK);
  float up = u >= Ui ? ISP_UO : ISP_UO * (1.0 - pow(1.0 - u / Ui, Ui / ISP_UO));
  return x * (ISP_YK * exp2(up) / Y);
}
vec3 drShoulder(vec3 x) {
  if (uDrS <= 0.0) return x;
  float Y = dot(LUMA, max(x, 0.0));
  if (Y <= uDrY0) return x;
  float nd = (Y - uDrY0) / uDrS;
  return x * ((uDrY0 + uDrS * nd / sqrt(1.0 + nd * nd)) / Y);
}
vec3 hdOp(vec3 v) {
  vec3 lab = linToOklab(srgbDec(v));
  if (lab.x <= 0.70) return v;
  float t = min(1.0, (lab.x - 0.70) / 0.30);
  lab.x = 0.70 + 0.30 * (t - uIspHd * t * t * sq(1.0 - t));
  return srgbEnc(gamutMap(lab));
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
  x = mhComposite(x, uvL);
  x = dehazeApply(x, uvG);
  if (uToneOps) x = baseTone(x, uvG);
  if (uCt != 0.0) x = contrastOp(x);
  if (uVig != 0.0) x *= vignetteF(uvG);
  x = clipNeg(x);
  x = filmShoulder(x);
  x = drShoulder(x);
  vec3 v = lutStage(x);
  if (uIspHd > 0.0) v = hdOp(v);
  outColor = vec4(v, 1.0);
}
`;

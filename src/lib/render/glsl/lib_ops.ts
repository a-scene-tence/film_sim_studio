// docs/RENDERER.md 섹션 6 lib_ops.glsl — 정본. Step 4 §5-2 패치(uHdfK), FSE-v2 §5-7-1 패치(mhComposite), OPT-v1 패치(cceOp Beer-Lambert·CPL, 디헤이즈 소프트 토, COLOR_SCIENCE §8.3·§10)만 허용.
export const LIB_OPS_GLSL = `// ===== lib_ops.glsl : shared per-pixel operators =====
uniform vec2 uDstSize;     // render target size (px)
uniform vec2 uTileOrigin;  // display-px origin of this target inside the full image (preview: 0,0)
uniform vec2 uImageSize;   // full display image size in this render's pixel units (preview: = uDstSize)
vec2 uvLocal() { return gl_FragCoord.xy / uDstSize; }
vec2 uvGlobal() { return (uTileOrigin + gl_FragCoord.xy) / uImageSize; }
vec3 emitHdf(vec3 x) { vec3 c = max(x, 0.0); float Y = dot(LUMA, c); return c * sstep(0.60, 2.00, Y); }
uniform bool uHdf;
uniform float uHdfK;       // diffusion strength 0..2 (UI 0..200 %, default 1)
uniform sampler2D uCore;   // core glow, sampled with local uv
uniform sampler2D uHalo;   // wide veil, sampled with global uv
vec3 hdfComposite(vec3 x, vec2 uvL, vec2 uvG) {
  if (!uHdf) return x;
  vec3 s = emitHdf(x);
  return x + uHdfK * (-0.48 * s + 0.30 * texture(uCore, uvL).rgb + 0.18 * texture(uHalo, uvG).rgb);
}
uniform float uIspMh;      // micro-halation gain = brand ISP mh x film strength (0 = off)
uniform vec3 uIspMhTint;   // micro-halation tint (brand ISP)
uniform sampler2D uMH;     // blurred micro-halation emitters, sampled with local uv
const float ISP_Y88 = 0.840607362;  // scene Y whose T_ref display L = 0.88
vec3 emitMh(vec3 x) { vec3 c = max(x, 0.0); float Y = dot(LUMA, c); return c * sstep(ISP_Y88, 2.04, Y); }
vec3 mhComposite(vec3 x, vec2 uvL) {
  if (uIspMh <= 0.0) return x;
  return x + uIspMh * (uIspMhTint * texture(uMH, uvL).rgb - 0.25 * emitMh(x));
}
float softplus(float t) { return max(t, 0.0) + log(1.0 + exp(-abs(t))); }
float softToe(float j) { return 0.004 * softplus(j / 0.004); }
uniform float uDehaze;     // -100..100
uniform vec3 uAtm;         // atmospheric light A
uniform sampler2D uTrans;  // R: transmission t (global uv)
vec3 dehazeApply(vec3 x, vec2 uvG) {
  if (uDehaze == 0.0) return x;
  vec3 J;
  if (uDehaze > 0.0) {
    float k = uDehaze / 100.0;
    float t = texture(uTrans, uvG).r;
    float te = mix(1.0, max(t, 0.1), k);
    J = (x - uAtm) / te + uAtm;
    return vec3(softToe(J.r), softToe(J.g), softToe(J.b));
  } else {
    float k = -uDehaze / 100.0;
    J = mix(x, uAtm, 0.4 * k);
  }
  return max(J, 0.0);
}
uniform float uKe;           // CCE 농도 계수 0 / 0.075 / 0.145
uniform float uKb;           // FX Blue CPL 농도 계수 0 / 0.065 / 0.13
uniform bool uMono;
uniform bool uCurveOn;
uniform sampler2D uCurve;    // 256x1 R16F
float curve1(float v) { return texture(uCurve, vec2((clamp(v, 0.0, 1.0) * 255.0 + 0.5) / 256.0, 0.5)).r; }
vec3 cceOp(vec3 v) {
  vec3 y = srgbDec(clamp(v, 0.0, 1.0));
  vec3 lab = linToOklab(y);
  float C = length(lab.yz);
  float h = atan(lab.z, lab.y) / DEG;
  float hd = h < 0.0 ? h + 360.0 : h;
  float mx = max(y.r, max(y.g, y.b));
  float sat = (mx - min(y.r, min(y.g, y.b))) / (mx + 0.05);
  float Y = dot(LUMA, y);
  float wTop = 1.0 - 0.3 * sstep(0.85, 1.05, Y);
  float wLum = sstep(0.06, 0.30, Y) * wTop;
  float dh = hd - 240.0;
  float wHueB = abs(dh) < 60.0 ? 0.5 * (1.0 + cos(3.141592653589793 * dh / 60.0)) : 0.0;
  float wSkin = exp(-0.5 * sq(wrap180(hd - 55.0) / 20.0)) * (1.0 - sstep(0.55, 0.85, sat));
  float we = uKe * sstep(0.25, 0.85, sat) * wLum * (1.0 - 0.7 * wSkin);
  float mb = wHueB * sstep(0.14, 0.72, sat) * sstep(0.02, 0.15, Y) * wTop;
  float pe = 1.0;
  if (we > 0.0 && C > 1e-6) {
    vec3 lb = linToOklab(pow(max(y, vec3(1e-5)), vec3(1.0 + we)));
    float rho = length(lb.yz) * lab.x / (max(lb.x, 1e-6) * C) - 1.0;
    float kap = 0.4 * uKe;
    pe = 1.0 + kap * tanh(clamp(rho / kap, -15.0, 15.0));
  }
  float fL = (1.0 - we) * (1.0 - uKb * mb);
  lab.x *= fL;
  lab.yz *= fL * pe * (1.0 + (uKb / 1.3) * mb);
  return srgbEnc(gamutMap(lab));
}
`;

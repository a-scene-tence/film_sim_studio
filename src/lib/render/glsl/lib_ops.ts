// docs/RENDERER.md 섹션 6 lib_ops.glsl — 정본. Step 4 §5-2 패치(uHdfK), FSE-v2 §5-7-1 패치(mhComposite)만 허용.
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
  } else {
    float k = -uDehaze / 100.0;
    J = mix(x, uAtm, 0.4 * k);
  }
  return max(J, 0.0);
}
uniform float uKe;           // CCE 강도 0 / 0.5 / 1
uniform float uKb;           // FX Blue 강도 0 / 0.5 / 1
uniform bool uMono;
uniform bool uCurveOn;
uniform sampler2D uCurve;    // 256x1 R16F
float curve1(float v) { return texture(uCurve, vec2((clamp(v, 0.0, 1.0) * 255.0 + 0.5) / 256.0, 0.5)).r; }
vec3 cceOp(vec3 v) {
  vec3 lab = linToOklab(srgbDec(v));
  float C = length(lab.yz);
  float h = atan(lab.z, lab.y) / DEG;
  float hd = h < 0.0 ? h + 360.0 : h;
  vec3 vc = clamp(v, 0.0, 1.0);
  float mx = max(vc.r, max(vc.g, vc.b));
  float S = (mx - min(vc.r, min(vc.g, vc.b))) / max(mx, 1e-4);
  float hueB = sstep(176.0, 190.0, hd) * (1.0 - sstep(270.0, 284.0, hd));
  float rgbB = sstep(0.0, 0.04, vc.b - 1.15 * vc.r) * sstep(0.0, 0.04, vc.b - 0.85 * vc.g);
  float blueW = hueB * rgbB;
  float skin = sstep(25.0, 38.0, hd) * (1.0 - sstep(68.0, 82.0, hd)) * (1.0 - sstep(0.50, 0.65, S)) * sstep(0.35, 0.50, lab.x);
  float me = sstep(0.18, 0.45, S) * (1.0 - blueW) * (1.0 - 0.5 * skin) * sstep(0.18, 0.25, lab.x) * (1.0 - sstep(0.92, 0.98, lab.x));
  float mb = blueW * sstep(0.012, 0.045, C) * sstep(0.15, 0.30, lab.x);
  lab.x *= 1.0 - 0.27 * uKe * me - 0.34 * uKb * mb;
  lab.yz *= 1.0 + 0.22 * uKe * me + 0.36 * uKb * mb;
  return srgbEnc(gamutMap(lab));
}
`;

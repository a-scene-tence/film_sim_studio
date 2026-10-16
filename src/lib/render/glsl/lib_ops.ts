// docs/RENDERER.md 섹션 6 lib_ops.glsl — 글자 그대로 옮긴 정본. 수정 금지.
export const LIB_OPS_GLSL = `// ===== lib_ops.glsl : shared per-pixel operators =====
uniform vec2 uDstSize;     // render target size (px)
uniform vec2 uTileOrigin;  // display-px origin of this target inside the full image (preview: 0,0)
uniform vec2 uImageSize;   // full display image size in this render's pixel units (preview: = uDstSize)
vec2 uvLocal() { return gl_FragCoord.xy / uDstSize; }
vec2 uvGlobal() { return (uTileOrigin + gl_FragCoord.xy) / uImageSize; }
vec3 emitHdf(vec3 x) { vec3 c = max(x, 0.0); float Y = dot(LUMA, c); return c * sstep(0.60, 2.00, Y); }
uniform bool uHdf;
uniform sampler2D uCore;   // core glow, sampled with local uv
uniform sampler2D uHalo;   // wide veil, sampled with global uv
vec3 hdfComposite(vec3 x, vec2 uvL, vec2 uvG) {
  if (!uHdf) return x;
  vec3 s = emitHdf(x);
  return x - 0.48 * s + 0.30 * texture(uCore, uvL).rgb + 0.18 * texture(uHalo, uvG).rgb;
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
uniform float uKe;           // CCE 0 / 0.10 / 0.20
uniform float uKb;           // FX Blue 0 / 0.12 / 0.24
uniform bool uMono;
uniform bool uCurveOn;
uniform sampler2D uCurve;    // 256x1 R16F
float curve1(float v) { return texture(uCurve, vec2((clamp(v, 0.0, 1.0) * 255.0 + 0.5) / 256.0, 0.5)).r; }
vec3 cceOp(vec3 v) {
  vec3 lab = linToOklab(srgbDec(v));
  float C = length(lab.yz);
  float h = atan(lab.z, lab.y) / DEG;
  float blue = exp(-0.5 * sq(wrap180(h - 264.0) / 28.0));
  float me = sstep(0.08, 0.20, C) * (1.0 - blue) * sstep(0.30, 0.70, lab.x);
  float mb = sstep(0.05, 0.16, C) * blue * sstep(0.20, 0.60, lab.x);
  lab.x = pow(max(lab.x, 0.0), 1.0 + uKe * me + uKb * mb);
  return srgbEnc(gamutMap(lab));
}
`;

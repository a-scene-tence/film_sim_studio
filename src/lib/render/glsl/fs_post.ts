// docs/RENDERER.md 섹션 6 fs_post.glsl — 정본. Step 4 §5-4 패치(uMonoTint)만 허용.
export const FS_POST_GLSL = `// ===== fs_post : S8~S11 (color chrome, tone curve, saturation/vibrance, clarity) =====
uniform sampler2D uMainTex;
uniform float uSat;          // -100..100
uniform float uVib;          // -100..100
uniform float uClarity;      // -100..100
uniform sampler2D uClarAB;   // RG (mean_a, mean_b), global uv
uniform vec2 uMonoTint;      // mono toning: C_t * (cos h, sin h), applied only when uMono
out vec4 outColor;
void main() {
  vec2 uvG = uvGlobal();
  vec3 v = texelFetch(uMainTex, ivec2(gl_FragCoord.xy), 0).rgb;
  if (!uMono && (uKe > 0.0 || uKb > 0.0)) v = cceOp(v);
  if (uCurveOn) v = vec3(curve1(v.r), curve1(v.g), curve1(v.b));
  bool tint = uMono && (uMonoTint.x != 0.0 || uMonoTint.y != 0.0);
  bool chroma = (uSat != 0.0 || uVib != 0.0);
  bool clar = (uClarity != 0.0);
  if (tint || chroma || clar) {
    vec3 lab = linToOklab(srgbDec(v));
    if (tint) lab.yz += uMonoTint * sstep(0.0, 0.25, lab.x) * (1.0 - sstep(0.85, 1.0, lab.x));
    if (chroma) {
      float C = length(lab.yz);
      float h = atan(lab.z, lab.y) / DEG;
      float C1 = C * (1.0 + uSat / 100.0);
      float skin = exp(-0.5 * sq(wrap180(h - 55.0) / 20.0));
      float g = uVib >= 0.0 ? 1.0 + (uVib / 100.0) * (1.0 - sstep(0.0, 0.20, C)) * (1.0 - 0.5 * skin)
                            : 1.0 + (uVib / 100.0) * (1.0 - 0.5 * sstep(0.0, 0.20, C));
      float C2 = max(0.0, C1 * g);
      lab.yz = C > 1e-9 ? lab.yz * (C2 / C) : vec2(0.0);
    }
    if (clar) {
      vec2 ab = texture(uClarAB, uvG).rg;
      float base = ab.x * lab.x + ab.y;
      lab.x = lab.x + 1.2 * (uClarity / 100.0) * (lab.x - base) * 4.0 * lab.x * (1.0 - lab.x);
    }
    v = srgbEnc(gamutMap(lab));
  }
  outColor = vec4(v, linToOklab(srgbDec(v)).x);
}
`;

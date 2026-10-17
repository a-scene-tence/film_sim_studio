// docs/RENDERER.md 섹션 6 — HDF·블러·가이드 필터·디헤이즈 보조 패스. 글자 그대로 옮긴 정본. 수정 금지.
export const FS_HDF_EXTRACT_GLSL = `// ===== fs_hdf_extract : emitters at half resolution =====
uniform sampler2D uWS;
uniform ivec2 uWSSize;
out vec4 outColor;
vec3 em(ivec2 q) { return emitHdf(texelFetch(uWS, min(q, uWSSize - 1), 0).rgb); }
void main() {
  ivec2 s = ivec2(gl_FragCoord.xy) * 2;
  outColor = vec4(0.25 * (em(s) + em(s + ivec2(1, 0)) + em(s + ivec2(0, 1)) + em(s + ivec2(1, 1))), 1.0);
}
`;

// FSE-v2 §5-7-2 마이크로 할레이션 추출 — 지시서 원문 그대로.
export const FS_MH_EXTRACT_GLSL = `// ===== fs_mh_extract : micro-halation emitters at half resolution =====
uniform sampler2D uWS;
uniform ivec2 uWSSize;
out vec4 outColor;
vec3 em(ivec2 q) { return emitMh(texelFetch(uWS, min(q, uWSSize - 1), 0).rgb); }
void main() {
  ivec2 s = ivec2(gl_FragCoord.xy) * 2;
  outColor = vec4(0.25 * (em(s) + em(s + ivec2(1, 0)) + em(s + ivec2(0, 1)) + em(s + ivec2(1, 1))), 1.0);
}
`;

export const FS_DOWN2_GLSL = `// ===== fs_down2 : exact 2x2 box =====
uniform sampler2D uIn;
uniform ivec2 uInSize;
out vec4 outColor;
vec4 f(ivec2 q) { return texelFetch(uIn, min(q, uInSize - 1), 0); }
void main() {
  ivec2 s = ivec2(gl_FragCoord.xy) * 2;
  outColor = 0.25 * (f(s) + f(s + ivec2(1, 0)) + f(s + ivec2(0, 1)) + f(s + ivec2(1, 1)));
}
`;

export const FS_GAUSS_GLSL = `// ===== fs_gauss : separable gaussian (radius <= 12) =====
uniform sampler2D uIn;
uniform ivec2 uInSize;
uniform ivec2 uDir;
uniform float uSigma;
uniform int uRadius;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int i = -12; i <= 12; i++) {
    if (i < -uRadius || i > uRadius) continue;
    float w = exp(-float(i * i) / (2.0 * uSigma * uSigma));
    acc += w * texelFetch(uIn, clamp(p + uDir * i, ivec2(0), uInSize - 1), 0);
    ws += w;
  }
  outColor = acc / ws;
}
`;

export const FS_BOX_GLSL = `// ===== fs_box : separable box (radius <= 32) =====
uniform sampler2D uIn;
uniform ivec2 uInSize;
uniform ivec2 uDir;
uniform int uRadius;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 acc = vec4(0.0);
  for (int i = -32; i <= 32; i++) {
    if (i < -uRadius || i > uRadius) continue;
    acc += texelFetch(uIn, clamp(p + uDir * i, ivec2(0), uInSize - 1), 0);
  }
  outColor = acc / float(2 * uRadius + 1);
}
`;

export const FS_GF_AB_GLSL = `// ===== fs_gf_ab : guided filter coefficients from (mean p, mean p^2) =====
uniform sampler2D uIn;
uniform float uEps;
out vec4 outColor;
void main() {
  vec2 m = texelFetch(uIn, ivec2(gl_FragCoord.xy), 0).rg;
  float v = max(m.y - m.x * m.x, 0.0);
  float a = v / (v + uEps);
  outColor = vec4(a, m.x - a * m.x, 0.0, 1.0);
}
`;

export const FS_MIN7_GLSL = `// ===== fs_min7 : separable 7-tap min on R =====
uniform sampler2D uIn;
uniform ivec2 uInSize;
uniform ivec2 uDir;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float m = 1e9;
  for (int i = -3; i <= 3; i++) m = min(m, texelFetch(uIn, clamp(p + uDir * i, ivec2(0), uInSize - 1), 0).r);
  outColor = vec4(m, 0.0, 0.0, 1.0);
}
`;

export const FS_PREP_GLSL = `// ===== fs_prep : analysis-resolution preparation (uMode 0 tone, 1 dehaze-A, 2 dehaze-ratio, 3 clarity) =====
uniform int uMode;
uniform sampler2D uWS;      // full-res WS (modes 0,1,2)
uniform sampler2D uMainTex; // tMain display-encoded (mode 3)
uniform vec2 uSrcPx;        // size of the sampled texture
out vec4 outColor;
vec3 wsAt(vec2 uv) { return texture(uWS, uv).rgb; }
void main() {
  vec2 uvG = uvGlobal();
  vec2 fp = uSrcPx / uDstSize;
  vec2 o = vec2(0.25) / uDstSize;
  bool four = max(fp.x, fp.y) > 1.0001;
  if (uMode == 3) {
    vec3 v = four ? 0.25 * (texture(uMainTex, uvG + vec2(-o.x, -o.y)).rgb + texture(uMainTex, uvG + vec2(o.x, -o.y)).rgb + texture(uMainTex, uvG + vec2(-o.x, o.y)).rgb + texture(uMainTex, uvG + vec2(o.x, o.y)).rgb) : texture(uMainTex, uvG).rgb;
    if (!uMono && (uKe > 0.0 || uKb > 0.0)) v = cceOp(v);
    if (uCurveOn) v = vec3(curve1(v.r), curve1(v.g), curve1(v.b));
    float L = linToOklab(srgbDec(v)).x;
    outColor = vec4(L, L * L, 0.0, 1.0);
    return;
  }
  vec3 x = four ? 0.25 * (wsAt(uvG + vec2(-o.x, -o.y)) + wsAt(uvG + vec2(o.x, -o.y)) + wsAt(uvG + vec2(-o.x, o.y)) + wsAt(uvG + vec2(o.x, o.y))) : wsAt(uvG);
  x = hdfComposite(x, uvG, uvG);
  if (uMode == 1) { outColor = vec4(x, min(x.r, min(x.g, x.b))); return; }
  if (uMode == 2) { vec3 r = x / max(uAtm, vec3(0.05)); outColor = vec4(min(r.r, min(r.g, r.b)), 0.0, 0.0, 1.0); return; }
  x = dehazeApply(x, uvG);
  float p = log2(max(dot(LUMA, x), exp2(-20.0)));
  outColor = vec4(p, p * p, 0.0, 1.0);
}
`;

export const FS_DZ_TT_GLSL = `// ===== fs_dz_tt : guided filter input (t~, t~^2) =====
uniform sampler2D uMinTex;
out vec4 outColor;
void main() {
  float tt = 1.0 - 0.95 * texelFetch(uMinTex, ivec2(gl_FragCoord.xy), 0).r;
  outColor = vec4(tt, tt * tt, 0.0, 1.0);
}
`;

export const FS_DZ_Q_GLSL = `// ===== fs_dz_q : transmission q = meanA * t~ + meanB =====
uniform sampler2D uMinTex;  // R: min-filtered ratio m
uniform sampler2D uAB;      // RG: (mean_a, mean_b) of guided filter on t~
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float tt = 1.0 - 0.95 * texelFetch(uMinTex, p, 0).r;
  vec2 ab = texelFetch(uAB, p, 0).rg;
  outColor = vec4(clamp(ab.x * tt + ab.y, 0.0, 1.0), 0.0, 0.0, 1.0);
}
`;

export const FS_BLURL_GLSL = `// ===== fs_blurL : separable gaussian sigma=1, radius 3 on L (uChan 3 = alpha, 0 = red) =====
uniform sampler2D uIn;
uniform ivec2 uInSize;
uniform ivec2 uDir;
uniform int uChan;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float acc = 0.0; float ws = 0.0;
  for (int i = -3; i <= 3; i++) {
    float w = exp(-0.5 * float(i * i));
    vec4 t = texelFetch(uIn, clamp(p + uDir * i, ivec2(0), uInSize - 1), 0);
    acc += w * (uChan == 3 ? t.a : t.r);
    ws += w;
  }
  outColor = vec4(acc / ws, 0.0, 0.0, 1.0);
}
`;

export const FS_PROBE_GLSL = `// ===== fs_probe : orientation probe sampling =====
uniform sampler2D uIn;
out vec4 outColor;
void main() { outColor = texture(uIn, gl_FragCoord.xy / vec2(64.0)); }
`;

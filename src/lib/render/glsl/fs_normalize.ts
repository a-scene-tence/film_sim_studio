// docs/RENDERER.md 섹션 6 fs_normalize.glsl — 정본. Step 4 §5-1 패치(uProfile 14 samsunglog)만 허용.
export const FS_NORMALIZE_GLSL = `// ===== fs_normalize : S0 source -> WS (+WB, exposure) =====
uniform sampler2D uSrc;
uniform vec2 uSrcSize;      // stored texture size
uniform int uOrient;        // residual orientation 1..8
uniform int uProfile;       // 0 srgb-image,1 rec709,2 hlg,3 slog3,4 slog2,5 flog,6 flog2,7 clog3,8 vlog,9 nlog,10 dlog,11 applelog,12 raw-linear,13 source-lut,14 samsunglog
uniform bool uLimitedCV;
uniform mat3 uSrcToWS;
uniform float uRawScale;
uniform sampler2D uToneInv; // 4096x1 R16F: Tref^-1((i/4095)^2.4)
uniform sampler3D uSrcLut;
uniform int uSrcLutN;
uniform bool uSrcLutInVR;
uniform bool uSrcLutOutVR;
uniform bool uSamsungFix;
uniform bool uRgc;
uniform bool uRolloff;
uniform mat3 uWB;
uniform float uExpGain;
out vec4 outColor;
float decodeLog(float y, int p) {
  if (p == 3) return y >= 171.2102946929 / 1023.0 ? pow(10.0, (1023.0 * y - 420.0) / 261.5) * 0.19 - 0.01 : (1023.0 * y - 95.0) * 0.01125 / (171.2102946929 - 95.0);
  if (p == 4) { float f = (1023.0 * y - 64.0) / 876.0; float s = y >= 0.0882512925 ? pow(10.0, (f - 0.646596) / 0.432699) - 0.037584 : (f - 0.030001222851889303) / 5.0; return s * 0.9 * 219.0 / 155.0; }
  if (p == 5) return y >= 0.100537775223865 ? (pow(10.0, (y - 0.790453) / 0.344676) - 0.009468) / 0.555556 : (y - 0.092864) / 8.735631;
  if (p == 6) return y >= 0.100686685370811 ? (pow(10.0, (y - 0.384316) / 0.245281) - 0.064829) / 5.555556 : (y - 0.092864) / 8.799461;
  if (p == 7) {
    float s;
    if (y < 0.097465473) s = -(pow(10.0, (0.12783901 - y) / 0.36726845) - 1.0) / 14.98325;
    else if (y <= 0.15277891) s = (y - 0.12512219) / 1.9754798;
    else s = (pow(10.0, (y - 0.12240537) / 0.36726845) - 1.0) / 14.98325;
    return 0.9 * s;
  }
  if (p == 8) return y < 0.181 ? (y - 0.125) / 5.6 : pow(10.0, (y - 0.598206) / 0.241514) - 0.00873;
  if (p == 9) { if (y < 0.4418377321603128) { float q = y / (650.0 / 1023.0); return q * q * q - 0.0075; } return exp((y - 619.0 / 1023.0) / (150.0 / 1023.0)); }
  if (p == 10) return y <= 0.14 ? (y - 0.0929) / 6.025 : (pow(10.0, 3.89616 * y - 2.27752) - 0.0108) / 0.9892;
  if (p == 11) {
    float Pt = 47.28711236 * (0.01 + 0.05641088) * (0.01 + 0.05641088);
    if (y >= Pt) return exp2((y - 0.69336945) / 0.08550479) - 0.00964052;
    if (y >= 0.0) return sqrt(y / 47.28711236) - 0.05641088;
    return -0.05641088;
  }
  if (p == 14) {
    if (y >= 0.206561909) return pow(10.0, (y - 0.720504856) / 0.258984868) - 0.0003645;
    if (y >= 0.0) return 0.016904 - pow(10.0, (y + 0.24597) / -0.20942);
    return -0.05;
  }
  if (p == 2) { float E = y <= 0.5 ? y * y / 3.0 : (exp((y - 0.55991073) / 0.17883277) + 0.28466892) / 12.0; return E * (0.18 / 0.0481333333); }
  return y;
}
float toneInv1(float s) { return texture(uToneInv, vec2((clamp(s, 0.0, 1.0) * 4095.0 + 0.5) / 4096.0, 0.5)).r; }
vec3 toneInv3(vec3 s) { return vec3(toneInv1(s.r), toneInv1(s.g), toneInv1(s.b)); }
vec3 decodeToSrcLinear(vec3 v) {
  if (uProfile == 0) return toneInv3(pow(max(srgbDec(v), 0.0), vec3(1.0 / 2.4)));
  if (uProfile == 1) return toneInv3(clamp(v, 0.0, 1.0));
  if (uProfile == 12) return v * uRawScale;
  if (uProfile == 13) {
    vec3 u = clamp(v, 0.0, 1.0);
    if (uSrcLutInVR) u = u * (876.0 / 1023.0) + 64.0 / 1023.0;
    vec3 o = lutTetra(uSrcLut, uSrcLutN, u);
    if (uSrcLutOutVR) o = (o * 1023.0 - 64.0) / 876.0;
    return toneInv3(clamp(o, 0.0, 1.0));
  }
  vec3 y = uLimitedCV ? (v * 876.0 + 64.0) / 1023.0 : v;
  return vec3(decodeLog(y.r, uProfile), decodeLog(y.g, uProfile), decodeLog(y.b, uProfile));
}
vec3 samsungFix(vec3 x) {
  vec3 lab = linToOklab(x);
  float C = length(lab.yz);
  float h = atan(lab.z, lab.y) / DEG;
  float w = exp(-0.5 * sq(wrap180(h - 50.0) / 16.0)) * sstep(0.02, 0.06, C) * (1.0 - sstep(0.85, 1.0, lab.x));
  float th = 4.0 * w * DEG;
  mat2 M = (1.0 - 0.04 * w) * mat2(cos(th), sin(th), -sin(th), cos(th));
  lab.yz = M * lab.yz;
  return oklabToLin(lab);
}
float rgcCompress(float d, float lim, float thr) {
  if (d < thr) return d;
  float scl = (lim - thr) / pow(pow((1.0 - thr) / (lim - thr), -1.2) - 1.0, 1.0 / 1.2);
  float nd = (d - thr) / scl;
  float p = pow(nd, 1.2);
  return thr + scl * nd / pow(1.0 + p, 1.0 / 1.2);
}
vec3 rgc(vec3 c) {
  float ach = max(c.r, max(c.g, c.b));
  if (ach <= 0.0) return c;
  vec3 d = (vec3(ach) - c) / ach;
  vec3 cd = vec3(rgcCompress(d.r, 1.147, 0.815), rgcCompress(d.g, 1.264, 0.803), rgcCompress(d.b, 1.312, 0.880));
  return vec3(ach) - cd * ach;
}
vec3 rolloffY(vec3 x) {
  float Y = dot(LUMA, max(x, 0.0));
  if (Y <= 1.0) return x;
  float Yp = 1.0 + (2.04 - 1.0) * tanh((Y - 1.0) / (2.04 - 1.0));
  return x * (Yp / Y);
}
vec3 fetchDecoded(vec2 uvD) { return decodeToSrcLinear(texture(uSrc, orientUv(uvD, uOrient)).rgb); }
void main() {
  vec2 uvD = gl_FragCoord.xy / uDstSize;
  vec2 srcDisp = (uOrient >= 5) ? uSrcSize.yx : uSrcSize;
  vec2 fp = srcDisp / uDstSize;
  vec3 acc;
  if (max(fp.x, fp.y) <= 1.0001) {
    acc = fetchDecoded(uvD);
  } else {
    vec2 o = vec2(0.25) / uDstSize;
    acc = 0.25 * (fetchDecoded(uvD + vec2(-o.x, -o.y)) + fetchDecoded(uvD + vec2(o.x, -o.y)) + fetchDecoded(uvD + vec2(-o.x, o.y)) + fetchDecoded(uvD + vec2(o.x, o.y)));
  }
  vec3 x = uSrcToWS * acc;
  if (uSamsungFix) x = samsungFix(x);
  if (uRgc) x = rgc(x);
  if (uRolloff) x = rolloffY(x);
  x = (uWB * x) * uExpGain;
  outColor = vec4(x, 1.0);
}
`;

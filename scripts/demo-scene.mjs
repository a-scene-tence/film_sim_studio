// Procedural demo scene (scene-linear Rec.709, 0.18 = mid grey). Deterministic.
export const CC = [[115,82,68],[194,150,130],[98,122,157],[87,108,67],[133,128,177],[103,189,170],[214,126,44],[80,91,166],[193,90,99],[94,60,108],[157,188,64],[224,163,46],[56,61,150],[70,148,73],[175,54,60],[231,199,31],[187,86,149],[8,133,161],[243,243,242],[200,200,200],[160,160,160],[122,122,121],[85,85,85],[52,52,52]];
export const SKIN = [[255,224,196],[234,192,156],[198,134,98],[141,85,54]];
const dec = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const lin8 = (c) => c.map((v) => dec(v / 255));
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function hash(ix, iy, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  const top = a + (b - a) * sx, bot = c + (d - c) * sx;
  return top + (bot - top) * sy;
}
export function fbm(x, y, oct, seed) { let s = 0, a = 0.5, f = 1; for (let o = 0; o < oct; o++) { s += a * vnoise(x * f, y * f, seed + o * 101); f *= 2.03; a *= 0.5; } return s / (1 - Math.pow(0.5, oct)); }
export function scenePixel(px, py, W, H) {
  const u = (px + 0.5) / W, v = (py + 0.5) / H, asp = W / H;
  const vh = 0.58, sunU = 0.68, sunV = 0.5;
  const du = (u - sunU) * asp, dv = v - sunV, d = Math.hypot(du, dv);
  // card + skin swatches + table
  if (v >= 0.8) {
    if (u >= 0.55 && u <= 0.95 && v >= 0.825 && v <= 0.975) {
      const gx = (u - 0.55) / 0.4 * 6, gy = (v - 0.825) / 0.15 * 4; const ix = Math.floor(gx), iy = Math.floor(gy);
      const fx = gx - ix, fy = gy - iy;
      if (ix < 6 && iy < 4 && fx > 0.08 && fx < 0.92 && fy > 0.1 && fy < 0.9) return lin8(CC[iy * 6 + ix]).map((c) => c * 0.9);
      return [0.012, 0.012, 0.013];
    }
    if (u >= 0.05 && u <= 0.45 && v >= 0.86 && v <= 0.94) {
      const k = Math.min(3, Math.floor((u - 0.05) / 0.1)); const fx = (u - 0.05) / 0.1 - k;
      if (fx > 0.06 && fx < 0.94) { const g = 0.85 + 0.15 * fbm(u * 300, v * 300, 3, 77); return lin8(SKIN[k]).map((c) => c * 0.75 * g); }
    }
    const wood = 0.7 + 0.6 * fbm(u * 2.5, v * 70, 5, 13);
    const light = 0.55 + 0.45 * sstep(0.3, 0.9, 1 - Math.abs(u - sunU));
    return [0.2, 0.11, 0.06].map((c) => c * wood * light);
  }
  // pier lights (neon bars)
  const bars = [[0.06, 0.14, [3.0, 0.15, 0.25]], [0.16, 0.24, [0.1, 1.6, 2.4]], [0.26, 0.34, [0.25, 0.35, 3.2]]];
  for (const [a, b, col] of bars) {
    if (v >= 0.72 && v <= 0.735 && u >= a && u <= b) return col;
  }
  let neon = [0, 0, 0];
  for (const [a, b, col] of bars) {
    const cu = Math.max(a - u, 0, u - b) * asp, cv = Math.max(0.72 - v, 0, v - 0.735);
    const g = Math.exp(-Math.hypot(cu, cv) / 0.012) * 0.35;
    neon = neon.map((n, i) => n + col[i] * g);
  }
  // sun disc and glow (shared)
  const glow = [1.0, 0.6, 0.3].map((c) => c * (1.8 * Math.exp(-((d / 0.08) ** 2)) + 0.6 * Math.exp(-d / 0.25)));
  // hills (left), silhouetted with warm rim
  const ridge = vh - (0.06 + 0.1 * fbm(u * 3.2, 1.3, 4, 9)) * sstep(0.62, 0.12, u);
  if (v < vh && v > ridge) {
    const tex = 0.55 + 0.9 * fbm(u * 90, v * 90, 4, 11);
    const rim = Math.exp(-(v - ridge) / 0.006) * 0.9 * sstep(0.0, 0.5, u);
    return [0.035, 0.075, 0.03].map((c, i) => c * tex + [1.0, 0.55, 0.25][i] * rim * 0.4 + neon[i]);
  }
  if (v < vh) {
    const t = v / vh;
    let sky = mix([0.035, 0.07, 0.2], [0.42, 0.42, 0.5], Math.pow(t, 1.2));
    sky = mix(sky, [1.25, 0.62, 0.3], Math.pow(t, 3.2));
    const c = fbm(u * 5 * asp / 1.5, v * 13, 5, 1);
    const cm = sstep(0.55, 0.78, c) * (1 - 0.6 * t);
    const lit = 0.6 + 1.2 * Math.exp(-d / 0.3);
    sky = mix(sky, [0.95 * lit, 0.55 * lit, 0.42 * lit], cm * 0.85);
    if (d < 0.035) return [12.0, 10.2, 7.2];
    return sky.map((s, i) => s + glow[i] * (1 - cm * 0.5) + neon[i]);
  }
  // water with sky reflection and sun streak
  const vr = 2 * vh - v, tr = Math.min(1, vr / vh);
  let refl = mix([0.035, 0.07, 0.2], [0.42, 0.42, 0.5], Math.pow(tr, 1.2));
  refl = mix(refl, [1.25, 0.62, 0.3], Math.pow(tr, 3.2)).map((c) => c * 0.45);
  const rip = fbm(u * 26, (v - vh) * 420, 3, 5);
  const width = 0.012 + 0.09 * (v - vh);
  const streak = Math.exp(-(((u - sunU) / width) ** 2)) * sstep(0.45, 0.75, rip) * 3.5;
  const base = [0.02, 0.05, 0.075].map((c) => c * (0.7 + 0.6 * rip));
  return base.map((c, i) => c + refl[i] * (0.6 + 0.4 * rip) + [1.0, 0.7, 0.4][i] * streak + neon[i] * 0.6 + glow[i] * 0.25);
}

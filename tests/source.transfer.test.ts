import { describe, expect, it } from "vitest";
import { matrixToWS, PRIMARY_TABLE, rgbToXyz } from "../src/lib/color/source/primaries.mjs";
import { decodeChannel, toWorkingSpace } from "../src/lib/color/source/normalize.mjs";
import { hlgE } from "../src/lib/color/source/transfer.mjs";

const M709 = [[0.412391, 0.357584, 0.180481], [0.212639, 0.715169, 0.072192], [0.019331, 0.119195, 0.950532]];
const GOLD_M: Record<string, number[][]> = {
  "display-p3": [[1.22494, -0.22494, 0], [-0.042057, 1.042057, 0], [-0.019638, -0.078636, 1.098274]],
  "adobe-rgb": [[1.398356, -0.398356, 0], [0, 1, 0], [0, -0.042929, 1.042929]],
  rec2020: [[1.660491, -0.587641, -0.07285], [-0.12455, 1.1329, -0.008349], [-0.018151, -0.100579, 1.11873]],
  "s-gamut3-cine": [[1.626947, -0.540139, -0.086809], [-0.178516, 1.417941, -0.239425], [-0.044436, -0.19592, 1.240356]],
  "s-gamut3": [[1.877915, -0.794169, -0.083746], [-0.176807, 1.351, -0.174193], [-0.026201, -0.148422, 1.174623]],
  "cinema-gamut": [[1.923861, -0.798761, -0.125101], [-0.204311, 1.495899, -0.291588], [-0.023685, -0.420127, 1.443812]],
  "v-gamut": [[1.806576, -0.695697, -0.110879], [-0.17009, 1.305955, -0.135865], [-0.025206, -0.154468, 1.179674]],
  "d-gamut": [[1.674723, -0.579789, -0.094934], [-0.098088, 1.333984, -0.235896], [-0.040967, -0.242984, 1.283951]],
  "f-gamut-c": [[2.119851, -1.075705, -0.044146], [-0.230336, 1.372442, -0.142106], [-0.014227, -0.150225, 1.164452]],
};
const desc = (profile: string, primaries = "srgb", range: "full" | "limited" = "full", rawScale: number | null = null) =>
  ({ profile, primaries, range, bitDepth: 8, rawScale }) as never;

describe("12.2 M_src→709 골든", () => {
  it("M_709→XYZ", () => {
    const m = rgbToXyz(PRIMARY_TABLE.srgb as never);
    m.forEach((r, i) => r.forEach((v, j) => expect(Math.abs(v - M709[i]![j]!)).toBeLessThan(1e-6)));
  });
  for (const [k, g] of Object.entries(GOLD_M)) {
    it(k, () => {
      const m = matrixToWS(k as never);
      g.forEach((r, i) => r.forEach((v, j) => expect(Math.abs(m[i]![j]! - v)).toBeLessThan(1e-6)));
    });
  }
});

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
describe("12.4 디코드 골든", () => {
  const G: Record<string, number[]> = {
    slog3: [0.0185131, 0.415263, 6.33266], slog2: [0.0479173, 0.569689, 3.93595], flog: [0.0178078, 0.241533, 1.9015],
    flog2: [0.0202332, 0.521557, 8.9008], clog3: [0.0376367, 0.580777, 4.14327], vlog: [0.0137196, 0.383349, 6.83886],
    nlog: [0.0236872, 0.488377, 3.77852], dlog: [0.0211764, 0.462534, 6.9734], applelog: [0.00862359, 0.198914, 2.36395],
  };
  for (const [p, g] of Object.entries(G)) {
    it(p, () => [0.2, 0.5, 0.8].forEach((y, i) => expect(rel(decodeChannel(y, desc(p)), g[i]!)).toBeLessThan(1e-5)));
  }
  it("HLG E", () => {
    expect(rel(hlgE(0.25), 0.0208333)).toBeLessThan(1e-5);
    expect(rel(hlgE(0.5), 0.0833333)).toBeLessThan(1e-5);
    expect(rel(hlgE(0.75), 0.264963)).toBeLessThan(1e-5);
  });
});

describe("12.4 toWorkingSpace 골든", () => {
  const close = (a: number[], b: number[], tol: number) => a.forEach((v, i) => expect(Math.abs(v - b[i]!) / Math.abs(b[i]!)).toBeLessThan(tol));
  it("srgb-image/srgb", () => close(toWorkingSpace([0.5, 0.5, 0.5], desc("srgb-image")), [0.201706, 0.201706, 0.201706], 1e-5));
  it("srgb-image/display-p3", () => {
    const o = toWorkingSpace([0.8, 0.4, 0.2], desc("srgb-image", "display-p3"));
    [0.812779, 0.106375, 0.021095].forEach((g, i) => expect(Math.abs(o[i]! - g)).toBeLessThan(2e-6));
  });
  it("rec709/srgb", () => close(toWorkingSpace([0.25, 0.5, 0.75], desc("rec709")), [0.043525, 0.179522, 0.523848], 1e-5));
  it("slog3/s-gamut3-cine/limited", () => close(toWorkingSpace([356 / 876, 356 / 876, 356 / 876], desc("slog3", "s-gamut3-cine", "limited")), [0.18, 0.18, 0.18], 1e-5));
  it("hlg/rec2020", () => close(toWorkingSpace([0.38, 0.38, 0.38], desc("hlg", "rec2020")), [0.18, 0.18, 0.18], 1e-5));
  it("raw-linear", () => close(toWorkingSpace([0.5, 0.5, 0.5], desc("raw-linear", "srgb", "full", 2.04)), [1.02, 1.02, 1.02], 1e-5));
  it("PQ 는 예외, Samsung Log / D-Log M 은 LUT 없이도 내장 변환 (Step 4 §4)", () => {
    expect(() => toWorkingSpace([0.5, 0.5, 0.5], desc("pq"))).toThrow();
    expect(() => toWorkingSpace([0.5, 0.5, 0.5], desc("dlogm", "rec2020"))).not.toThrow();
    expect(() => toWorkingSpace([0.5, 0.5, 0.5], desc("samsunglog", "rec2020"))).not.toThrow();
  });
});

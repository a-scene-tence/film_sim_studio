import { tetraSample } from "@/lib/color/fse/tetra.mjs";
import { BAKE_SIZE, type ParseResult, type ParsedLut } from "./types";

const DATA_ROW = /^[-+]?(\d|\.\d|nan|inf)/i;
const MAX_RANGE_WARNINGS = 5;

function emptyLut(warnings: string[]): ParsedLut {
  return {
    size: 0,
    data: new Float32Array(0),
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    inVideoRange: false,
    outVideoRange: false,
    warnings,
  };
}

function parseNumbers(tokens: string[], count: number): number[] | null {
  if (tokens.length !== count) return null;
  const out = tokens.map(Number);
  return out.every((v) => Number.isFinite(v)) ? out : null;
}

/** 채널별 1D 선형 보간. table 은 길이 M·3, u 는 [0,1] 로 clamp 된다. */
function sample1D(table: Float32Array, M: number, u: number, c: number): number {
  const p = Math.min(1, Math.max(0, u)) * (M - 1);
  const i = Math.min(Math.floor(p), M - 2);
  const f = p - i;
  const a = table[i * 3 + c] ?? 0;
  const b = table[(i + 1) * 3 + c] ?? 0;
  return a + (b - a) * f;
}

/**
 * Adobe/Resolve .cube 파서. 1D 단독 → 33³ 로 굽기, 1D+3D(Resolve 셰이퍼 형식) → 1D 를 앞단에 합성해 33³ 로 굽기.
 * 오류·경고는 한국어 + 줄 번호.
 */
export function parseCube(text: string): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let size3 = 0;
  let size1 = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  let range1: [number, number] | null = null;
  let range3: [number, number] | null = null;
  let inVideoRange = false;
  let outVideoRange = false;
  const rows: number[] = [];
  let rangeWarnings = 0;
  let lastDataLine = 0;

  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = src.split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const lineNo = ln + 1;
    const line = (lines[ln] ?? "").trim();
    if (line === "" || line.startsWith("#")) continue;

    if (DATA_ROW.test(line)) {
      const tokens = line.split(/\s+/);
      if (tokens.length !== 3) {
        errors.push(`줄 ${lineNo}: 데이터 행은 실수 3개여야 합니다 (실제 ${tokens.length}개)`);
        continue;
      }
      const vals = tokens.map(Number);
      if (!vals.every((v) => Number.isFinite(v))) {
        errors.push(`줄 ${lineNo}: 유한하지 않은 값(NaN/Infinity)이 있습니다: ${line}`);
        continue;
      }
      if (vals.some((v) => v < -0.5 || v > 1.5)) {
        rangeWarnings++;
        if (rangeWarnings <= MAX_RANGE_WARNINGS) warnings.push(`줄 ${lineNo}: [−0.5, 1.5] 범위를 벗어난 값: ${line}`);
      }
      rows.push(vals[0] ?? 0, vals[1] ?? 0, vals[2] ?? 0);
      lastDataLine = lineNo;
      continue;
    }

    const sp = line.search(/\s/);
    const keyword = (sp < 0 ? line : line.slice(0, sp)).toUpperCase();
    const rest = sp < 0 ? "" : line.slice(sp).trim();
    const tokens = rest === "" ? [] : rest.split(/\s+/);
    switch (keyword) {
      case "TITLE": {
        if (!/^".*"$/.test(rest)) warnings.push(`줄 ${lineNo}: TITLE 은 큰따옴표로 감싼 문자열이어야 합니다`);
        break;
      }
      case "LUT_3D_SIZE": {
        const n = parseNumbers(tokens, 1);
        const v = n?.[0];
        if (v === undefined || !Number.isInteger(v) || v < 2 || v > 65) errors.push(`줄 ${lineNo}: LUT_3D_SIZE 는 2~65 사이 정수여야 합니다 (값: ${rest || "없음"})`);
        else size3 = v;
        break;
      }
      case "LUT_1D_SIZE": {
        const n = parseNumbers(tokens, 1);
        const v = n?.[0];
        if (v === undefined || !Number.isInteger(v) || v < 2 || v > 65536) errors.push(`줄 ${lineNo}: LUT_1D_SIZE 는 2~65536 사이 정수여야 합니다 (값: ${rest || "없음"})`);
        else size1 = v;
        break;
      }
      case "DOMAIN_MIN":
      case "DOMAIN_MAX": {
        const n = parseNumbers(tokens, 3);
        if (!n) errors.push(`줄 ${lineNo}: ${keyword} 는 실수 3개가 필요합니다`);
        else if (keyword === "DOMAIN_MIN") domainMin = [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0];
        else domainMax = [n[0] ?? 1, n[1] ?? 1, n[2] ?? 1];
        break;
      }
      case "LUT_3D_INPUT_RANGE":
      case "LUT_1D_INPUT_RANGE": {
        const n = parseNumbers(tokens, 2);
        if (!n) {
          errors.push(`줄 ${lineNo}: ${keyword} 는 실수 2개(lo hi)가 필요합니다`);
          break;
        }
        const lo = n[0] ?? 0;
        const hi = n[1] ?? 1;
        if (keyword === "LUT_1D_INPUT_RANGE") range1 = [lo, hi];
        else range3 = [lo, hi];
        break;
      }
      case "LUT_IN_VIDEO_RANGE":
        inVideoRange = true;
        break;
      case "LUT_OUT_VIDEO_RANGE":
        outVideoRange = true;
        break;
      default:
        warnings.push(`알 수 없는 키워드 무시: ${lineNo}: ${keyword}`);
    }
  }

  // INPUT_RANGE 는 세 채널 동일 도메인으로 설정한다. 1D+3D 조합이면 바깥(입력) 도메인은 1D 의 범위다.
  const outer = size1 > 0 ? range1 : range3;
  if (outer) {
    domainMin = [outer[0], outer[0], outer[0]];
    domainMax = [outer[1], outer[1], outer[1]];
  }
  for (let c = 0; c < 3; c++) {
    if (!((domainMax[c] ?? 1) > (domainMin[c] ?? 0))) {
      errors.push(`도메인 오류: DOMAIN_MAX 가 DOMAIN_MIN 보다 커야 합니다 (채널 ${c})`);
      break;
    }
  }

  if (size1 === 0 && size3 === 0) errors.push("LUT_3D_SIZE 또는 LUT_1D_SIZE 키워드가 없습니다");
  const rowCount = rows.length / 3;
  const expected = size1 + size3 * size3 * size3;
  if ((size1 > 0 || size3 > 0) && rowCount !== expected) {
    errors.push(`데이터 행 수 불일치: 기대 ${expected}, 실제 ${rowCount} (마지막 데이터 줄 ${lastDataLine})`);
  }
  if (rangeWarnings > MAX_RANGE_WARNINGS) warnings.push(`[−0.5, 1.5] 범위를 벗어난 행이 총 ${rangeWarnings}개 있습니다`);
  if (errors.length > 0) return { lut: emptyLut(warnings), errors };

  const base = { domainMin, domainMax, inVideoRange, outVideoRange, warnings };

  if (size1 === 0) {
    return { lut: { ...base, size: size3, data: Float32Array.from(rows) }, errors };
  }

  const table1 = Float32Array.from(rows.slice(0, size1 * 3));
  const N = BAKE_SIZE;
  const data = new Float32Array(N * N * N * 3);
  let o = 0;
  if (size3 === 0) {
    for (let bi = 0; bi < N; bi++)
      for (let gi = 0; gi < N; gi++)
        for (let ri = 0; ri < N; ri++) {
          data[o++] = sample1D(table1, size1, ri / (N - 1), 0);
          data[o++] = sample1D(table1, size1, gi / (N - 1), 1);
          data[o++] = sample1D(table1, size1, bi / (N - 1), 2);
        }
    return { lut: { ...base, size: N, data }, errors };
  }

  const table3 = Float32Array.from(rows.slice(size1 * 3));
  const lo3 = range3 && range1 ? range3[0] : 0;
  const hi3 = range3 && range1 ? range3[1] : 1;
  for (let bi = 0; bi < N; bi++)
    for (let gi = 0; gi < N; gi++)
      for (let ri = 0; ri < N; ri++) {
        const s = [
          (sample1D(table1, size1, ri / (N - 1), 0) - lo3) / (hi3 - lo3),
          (sample1D(table1, size1, gi / (N - 1), 1) - lo3) / (hi3 - lo3),
          (sample1D(table1, size1, bi / (N - 1), 2) - lo3) / (hi3 - lo3),
        ];
        const v = tetraSample(table3, size3, s);
        data[o++] = v[0];
        data[o++] = v[1];
        data[o++] = v[2];
      }
  return { lut: { ...base, size: N, data }, errors };
}

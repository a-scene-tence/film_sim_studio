// docs/COLOR_SCIENCE.md §4 — 소스 코드값 → WS(선형 Rec.709, D65). 단일 점 구현이 명세 원문이다.
import { REF_TONE } from "../fse/constants.mjs";
import { srgbDec, toneInv } from "../fse/engine.mjs";
import { tetraSample } from "../fse/tetra.mjs";
import { matrixToWS, apply3 } from "./primaries.mjs";
import * as T from "./transfer.mjs";

/**
 * @typedef {{ profile: string, primaries: import("./primaries.mjs").PrimariesId, range: "full" | "limited", bitDepth: number, rawScale: number | null }} SourceDescriptor
 * @typedef {{ size: number, data: ArrayLike<number> }} SourceLut
 */

const LOG_PROFILES = new Set(["slog3", "slog2", "flog", "flog2", "clog3", "vlog", "nlog", "samsunglog"]);
const DECODERS = /** @type {Record<string, (y: number) => number>} */ ({
  slog3: T.slog3, slog2: T.slog2, flog: T.flog, flog2: T.flog2, clog3: T.clog3,
  vlog: T.vlog, nlog: T.nlog, dlog: T.dlog, applelog: T.applelog, hlg: T.hlg, samsunglog: T.samsunglog,
});

/** 소스 LUT 가 필요한데 없을 때 던지는 예외 코드 */
export const SOURCE_TRANSFORM_LUT_REQUIRED = "SOURCE_TRANSFORM_LUT_REQUIRED";
export const PQ_UNSUPPORTED = "PQ_UNSUPPORTED";

/** @param {string} code @param {string} message */
function coded(code, message) {
  const e = /** @type {Error & { code: string }} */ (new Error(message));
  e.code = code;
  return e;
}

/**
 * §4.0 / 12.3-1: Limited 로그 소스는 y = (v·876+64)/1023
 * @param {number} v @param {SourceDescriptor} d
 */
function codeValue(v, d) {
  return LOG_PROFILES.has(d.profile) && d.range === "limited" ? (v * 876 + 64) / 1023 : v;
}

/**
 * 채널별 디코드 → 소스 원색 선형 x
 * @param {number} v @param {SourceDescriptor} d
 */
export function decodeChannel(v, d) {
  const y = codeValue(v, d);
  if (d.profile === "srgb-image") return toneInv(srgbDec(y));
  if (d.profile === "rec709") return toneInv(Math.pow(Math.max(y, 0), 2.4));
  if (d.profile === "raw-linear") return y * /** @type {number} */ (d.rawScale);
  const f = DECODERS[d.profile];
  if (!f) throw coded("DECODE_FAILED", `알 수 없는 소스 프로파일: ${d.profile}`);
  return f(y);
}

/**
 * v[3] (소스 인코딩 그대로 0~1) → WS 선형
 * @param {ArrayLike<number>} v
 * @param {SourceDescriptor} d
 * @param {SourceLut} [sourceLut]
 * @returns {[number, number, number]}
 */
export function toWorkingSpace(v, d, sourceLut) {
  if (d.profile === "pq") throw coded(PQ_UNSUPPORTED, "HDR10(PQ) 영상은 지원하지 않습니다");
  if ((d.profile === "samsunglog" || d.profile === "dlogm") && sourceLut) {
    // 사용자 공식 LUT(profile 13): LUT 출력은 Rec.709 표시 인코딩이며 WS 와 같은 원색이다 (Step 3 소스 LUT 규칙)
    const out = tetraSample(sourceLut.data, sourceLut.size, [/** @type {number} */ (v[0]), /** @type {number} */ (v[1]), /** @type {number} */ (v[2])]);
    const d709 = { ...d, profile: "rec709" };
    return [decodeChannel(out[0], d709), decodeChannel(out[1], d709), decodeChannel(out[2], d709)];
  }
  // 내장 변환 (Step 4 §4-1, §4-2): Samsung Log = 공식 수식 + Rec.2020, D-Log M = D-Log 곡선 + D-Gamut 근사
  const eff = d.profile === "dlogm" ? { ...d, profile: "dlog", primaries: /** @type {import("./primaries.mjs").PrimariesId} */ ("d-gamut"), range: /** @type {"full"} */ ("full") }
    : d.profile === "samsunglog" ? { ...d, primaries: /** @type {import("./primaries.mjs").PrimariesId} */ ("rec2020") } : d;
  const x = [decodeChannel(/** @type {number} */ (v[0]), eff), decodeChannel(/** @type {number} */ (v[1]), eff), decodeChannel(/** @type {number} */ (v[2]), eff)];
  return apply3(matrixToWS(eff.primaries), x);
}

// ── 대량 처리용 CPU 가속 (표시 전용 경로) ─────────────────────────────────────
// §4.11 은 GPU 에서 Tref⁻¹ 를 테이블로 샘플한다. CPU 대량 경로도 같은 방식으로,
// 노드 값은 §4.11 이분법(48회) 정확값이고 노드 사이만 선형 보간한다.
const TABLE_N = 16384;
/** @type {Float64Array | null} */
let toneInvTable = null;
/** @param {number} d */
function toneInvFast(d) {
  if (d <= 0) return 0;
  if (d >= 1) return REF_TONE.hdrMax;
  if (!toneInvTable) {
    toneInvTable = new Float64Array(TABLE_N + 1);
    for (let i = 0; i <= TABLE_N; i++) toneInvTable[i] = toneInv(i / TABLE_N);
  }
  const p = d * TABLE_N;
  const i = Math.min(Math.floor(p), TABLE_N - 1);
  const t = p - i;
  return /** @type {number} */ (toneInvTable[i]) * (1 - t) + /** @type {number} */ (toneInvTable[i + 1]) * t;
}

/**
 * RGBA 인터리브 버퍼 전체를 WS 선형 RGBA 로 변환한다 (알파 그대로). srgb-image/rec709 는 toneInvFast 를 쓴다.
 * @param {Float32Array} src @param {Float32Array} dst @param {SourceDescriptor} d @param {SourceLut} [sourceLut]
 */
export function toWorkingSpaceBuffer(src, dst, d, sourceLut) {
  const M = matrixToWS(d.primaries);
  const fast = d.profile === "srgb-image" || d.profile === "rec709";
  const px = /** @type {[number, number, number]} */ ([0, 0, 0]);
  for (let i = 0; i < src.length; i += 4) {
    let w;
    if (fast) {
      for (let c = 0; c < 3; c++) {
        const y = /** @type {number} */ (src[i + c]);
        px[c] = toneInvFast(d.profile === "srgb-image" ? srgbDec(y) : Math.pow(Math.max(y, 0), 2.4));
      }
      w = apply3(M, px);
    } else {
      w = toWorkingSpace([src[i], src[i + 1], src[i + 2]], d, sourceLut);
    }
    dst[i] = w[0];
    dst[i + 1] = w[1];
    dst[i + 2] = w[2];
    dst[i + 3] = /** @type {number} */ (src[i + 3]);
  }
}

import { errors } from "./errors";
import type { HistogramStats, LogDetection, SourcePrimaries, SourceProfileId } from "./types";
import { isLogLike } from "./histogram";

/** 11.2 프로파일 표 (vBlack = 반사율 0 의 Full 확장 신호값, 기본 원색) — 표 순서가 동률 정렬 순서 */
export const PROFILE_TABLE: ReadonlyArray<{ id: SourceProfileId; vBlack: number | null; primaries: SourcePrimaries }> = [
  { id: "slog3", vBlack: 0.0354, primaries: "s-gamut3-cine" },
  { id: "slog2", vBlack: 0.03, primaries: "s-gamut3" },
  { id: "flog", vBlack: 0.0354, primaries: "rec2020" },
  { id: "flog2", vBlack: 0.0354, primaries: "rec2020" },
  { id: "clog3", vBlack: 0.0731, primaries: "cinema-gamut" },
  { id: "vlog", vBlack: 0.0729, primaries: "v-gamut" },
  { id: "nlog", vBlack: 0.0722, primaries: "rec2020" },
  { id: "dlog", vBlack: 0.0929, primaries: "d-gamut" },
  { id: "applelog", vBlack: 0.1505, primaries: "rec2020" },
  { id: "hlg", vBlack: null, primaries: "rec2020" },
  { id: "samsunglog", vBlack: null, primaries: "rec2020" },
  { id: "dlogm", vBlack: null, primaries: "rec2020" },
];

export function defaultPrimaries(p: SourceProfileId): SourcePrimaries {
  return PROFILE_TABLE.find((x) => x.id === p)?.primaries ?? "srgb";
}
export const requiresSourceLut = (p: SourceProfileId) => p === "samsunglog" || p === "dlogm";

export interface LogDetectInput {
  colour: { primaries: number | null; transfer: number | null; matrix: number | null; fullRange: boolean | null };
  fileName: string;
  /** 11.1 최상위 박스 텍스트 (소문자화는 여기서도 보장) */
  metaText: string;
  make: string | null;
  histogram: Pick<HistogramStats, "p0_1" | "p50" | "p99_9"> | null;
}

const SUBSTRINGS: Array<[string[], SourceProfileId]> = [
  [["apple log", "applelog"], "applelog"], [["f-log2"], "flog2"], [["f-log"], "flog"], [["d-log m", "d-log-m", "dlog-m", "dlogm"], "dlogm"],
  [["d-log"], "dlog"], [["c-log3", "canon log 3", "clog3"], "clog3"], [["v-log"], "vlog"], [["n-log"], "nlog"], [["samsung log"], "samsunglog"],
];
const FILE_TOKENS: SourceProfileId[] = ["slog3", "slog2", "applelog", "flog2", "flog", "dlogm", "dlog", "clog3", "vlog", "nlog", "samsunglog", "hlg"];
const MAKERS: Array<[string, SourceProfileId]> = [["samsung", "samsunglog"], ["apple", "applelog"], ["dji", "dlogm"], ["sony", "slog3"], ["fujifilm", "flog2"], ["canon", "clog3"], ["panasonic", "vlog"], ["nikon", "nlog"]];

function mk(profile: SourceProfileId, confidence: LogDetection["confidence"], autoApply: boolean, evidence: string[], candidates: SourceProfileId[] = [], primaries?: SourcePrimaries): LogDetection {
  return { profile, primaries: primaries ?? defaultPrimaries(profile), confidence, autoApply, candidates, evidence, requiresSourceLut: requiresSourceLut(profile) };
}

/** 11.2 감지 파이프라인: 위에서부터 처음 확정된 단계를 쓴다. */
export function detectLog(input: LogDetectInput): LogDetection {
  // A. 태그
  const tr = input.colour.transfer;
  if (tr === 18) return mk("hlg", "tag", true, ["colr transfer=18 (HLG)"], [], "rec2020");
  if (tr === 16) throw errors.pq();

  // B. 메타데이터 문자열
  const text = input.metaText.toLowerCase();
  const g = /capturegammaequation\s+value\s*=\s*"([^"]+)"/.exec(text)?.[1];
  const p = /capturecolorprimaries\s+value\s*=\s*"([^"]+)"/.exec(text)?.[1];
  if (g) {
    let prof: SourceProfileId | null = null;
    if (g.includes("s-log3")) prof = "slog3";
    else if (g.includes("s-log2")) prof = "slog2";
    else if (g.includes("hlg")) prof = "hlg";
    else if (g.includes("rec709") || g.includes("itu709") || g.includes("s-cinetone")) prof = "rec709";
    if (prof) {
      let prim: SourcePrimaries = prof === "rec709" ? "srgb" : defaultPrimaries(prof);
      if (p) {
        if (p.includes("s-gamut3-cine") || p.includes("s-gamut3.cine")) prim = "s-gamut3-cine";
        else if (p.includes("s-gamut3") || p.includes("s-gamut")) prim = "s-gamut3";
        else if (p.includes("rec2020") || p.includes("itu2020")) prim = "rec2020";
      }
      return mk(prof, "metadata", true, [`CaptureGammaEquation="${g}"`, ...(p ? [`CaptureColorPrimaries="${p}"`] : [])], [], prim);
    }
  }
  for (const [keys, prof] of SUBSTRINGS) {
    const hit = keys.find((k) => text.includes(k));
    if (hit) return mk(prof, "metadata", true, [`메타데이터 문자열 "${hit}"`]);
  }

  // C. 파일명
  const norm = input.fileName.toLowerCase().replace(/\.[^.]*$/, "").replace(/[\s_.\-]/g, "");
  for (const t of FILE_TOKENS) {
    if (norm.includes(t)) return mk(t, "filename", !(t === "vlog" || t === "dlog"), [`파일명 토큰 "${t}"`]);
  }

  // D. 히스토그램 제안 (autoApply false)
  const h = input.histogram;
  if (h && isLogLike(h)) {
    const make = (input.make ?? "").toLowerCase();
    let maker = MAKERS.find(([k]) => make.includes(k));
    if (!maker) maker = MAKERS.find(([k]) => text.includes(k));
    if (maker) return mk(maker[1], "histogram-suggestion", false, [`로그형 히스토그램 (p0.1=${h.p0_1.toFixed(3)}, p50=${h.p50.toFixed(3)}, p99.9=${h.p99_9.toFixed(3)})`, `제조사 "${maker[0]}"`], [maker[1]]);
    const cands = PROFILE_TABLE.map((x, i) => ({ x, i })).filter(({ x }) => x.vBlack !== null && x.vBlack <= h.p0_1 + 0.01).sort((a, b) => b.x.vBlack! - a.x.vBlack! || a.i - b.i).map(({ x }) => x.id);
    if (cands.length) return mk(cands[0]!, "histogram-suggestion", false, [`로그형 히스토그램 (p0.1=${h.p0_1.toFixed(3)}), 제조사 불명 — 블랙 레벨로 후보 추정`], cands);
  }

  // E. 기본
  return mk("rec709", "default", true, ["감지 근거 없음 — Rec.709 로 엽니다"], [], "srgb");
}

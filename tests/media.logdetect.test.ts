import { describe, expect, it } from "vitest";
import { detectLog, PROFILE_TABLE, type LogDetectInput } from "../src/lib/media/log-detect";

const base: LogDetectInput = { colour: { primaries: null, transfer: null, matrix: null, fullRange: null }, fileName: "clip.mp4", metaText: "", make: null, histogram: null };

describe("Log 감지 11.2", () => {
  it("a. Sony XML", () => {
    const d = detectLog({ ...base, metaText: '<CaptureGammaEquation value="s-log3-cine"/><CaptureColorPrimaries value="s-gamut3-cine"/>' });
    expect([d.profile, d.primaries, d.confidence, d.autoApply]).toEqual(["slog3", "s-gamut3-cine", "metadata", true]);
  });
  it("b. 파일명 DLogM", () => {
    const d = detectLog({ ...base, fileName: "DJI_0001_DLogM.MP4" });
    expect([d.profile, d.confidence, d.requiresSourceLut, d.approximate, d.autoApply]).toEqual(["dlogm", "filename", false, true, true]);
  });
  it("Step 4 §4-4: approximate 는 dlogm 만 true, samsunglog 는 내장 공식 변환", () => {
    const sam = detectLog({ ...base, fileName: "clip_samsunglog.mp4" });
    expect([sam.profile, sam.requiresSourceLut, sam.approximate]).toEqual(["samsunglog", false, false]);
    expect(PROFILE_TABLE.find((x) => x.id === "samsunglog")).toMatchObject({ vBlack: 0.0731, vGrey: 0.5434 });
    for (const f of ["a_slog3.mp4", "a_applelog.mp4", "a_flog2.mp4", "a_hlg.mp4"]) expect(detectLog({ ...base, fileName: f }).approximate).toBe(false);
    expect(detectLog({ ...base }).approximate).toBe(false);
  });
  it("c. my_vlog_day1 은 제안만", () => {
    const d = detectLog({ ...base, fileName: "my_vlog_day1.mp4" });
    expect([d.profile, d.confidence, d.autoApply]).toEqual(["vlog", "filename", false]);
  });
  it("d. 히스토그램 + Apple", () => {
    const d = detectLog({ ...base, make: "Apple", histogram: { p0_1: 0.16, p50: 0.45, p99_9: 0.8 } });
    expect([d.profile, d.confidence, d.autoApply]).toEqual(["applelog", "histogram-suggestion", false]);
  });
  it("e. 제조사 없음: vBlack ≤ p0.1+0.01 후보를 내림차순", () => {
    const d = detectLog({ ...base, histogram: { p0_1: 0.06, p50: 0.4, p99_9: 0.8 } });
    expect(d.candidates).toEqual(["slog3", "flog", "flog2", "slog2"]);
    expect([d.profile, d.autoApply]).toEqual(["slog3", false]);
  });
  it("f. p0.1=0 은 rec709 default", () => {
    const d = detectLog({ ...base, histogram: { p0_1: 0, p50: 0.4, p99_9: 0.8 } });
    expect([d.profile, d.confidence]).toEqual(["rec709", "default"]);
  });
});

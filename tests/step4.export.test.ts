// Step 4 §10~§12 저장 사양 — T14 T15 T16 T17 T18
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { decode as decodePng } from "fast-png";
import piexif from "piexifjs";
import { beforeAll, describe, expect, it } from "vitest";
import { areaDownsample, AreaDownsampler, spans } from "../src/lib/export/area-downsample";
import { estimateBytes, fmtActualBytes, fmtBytes, photoMemoryPlan } from "../src/lib/export/estimate";
import { exportName } from "../src/lib/export/filename";
import { outSize } from "../src/lib/export/out-size";
import { encodeJpeg, encodePng, initJpeg, jpegOptions } from "../src/lib/export/photo-encode";
import { tileGrid } from "../src/lib/export/tile-grid";
import { exifSegmentLength, planPhoto } from "../src/lib/export/photo-export";
import {
  audioPlan, estimateVideoBytes, fpsLine, fpsPlan, formatLine, has1080Option, pickContainerCodec, progressLine, rotationToOrientation, video1080, videoBitrate, videoTooLarge,
  type AudioCaps,
} from "../src/lib/export/video-plan";
import { orientationFromMatrix } from "../src/lib/media/video-probe";
import { pickRecorderMime } from "../src/lib/export/recorder-fallback";
import { extractPayload } from "../src/lib/exif/extract";
import { inspectOutputExif, insertExifIntoJpeg } from "../src/lib/exif-manager";

describe("T14 저장 순수 함수", () => {
  it("outSize 골든", () => {
    expect(outSize(6000, 4000, 4096)).toEqual({ width: 4096, height: 2731 });
    expect(outSize(6000, 4000, 2048)).toEqual({ width: 2048, height: 1365 });
    expect(outSize(4000, 6000, 2048)).toEqual({ width: 1365, height: 2048 });
    expect(outSize(3000, 2000, 4096)).toEqual({ width: 3000, height: 2000 });
    expect(outSize(4031, 3023, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(outSize(6000, 4000, "full")).toEqual({ width: 6000, height: 4000 });
  });
  it("tileGrid 골든", () => {
    const g = tileGrid(6000, 4000);
    expect(g.length).toBe(24);
    expect(g[5]).toEqual({ x: 5120, y: 0, w: 880, h: 1024 });
    expect(g[23]).toEqual({ x: 5120, y: 3072, w: 880, h: 928 });
    expect(tileGrid(1024, 1024).length).toBe(1);
    expect(tileGrid(1025, 1)).toEqual([{ x: 0, y: 0, w: 1024, h: 1 }, { x: 1024, y: 0, w: 1, h: 1 }]);
  });
  it("spans 골든", () => {
    const s = spans(5, 2);
    const want = [[[0, 0.4], [1, 0.4], [2, 0.2]], [[2, 0.2], [3, 0.4], [4, 0.4]]];
    s.forEach((l, o) => l.forEach(([i, w], k) => { expect(i).toBe(want[o]![k]![0]); expect(w).toBeCloseTo(want[o]![k]![1]!, 12); }));
  });
  it("areaDownsample 골든", () => {
    const px: number[] = [];
    for (let i = 0; i < 15; i++) px.push((i * 37) % 256, (i * 91) % 256, (i * 13) % 256, 255);
    expect([...areaDownsample(px, 5, 3, 2, 1)]).toEqual([141, 146, 95, 255, 127, 157, 122, 255]);
    expect([...areaDownsample([0, 0, 0, 255, 255, 255, 255, 255], 2, 1, 1, 1)]).toEqual([188, 188, 188, 255]);
  });
  it("스트리밍(밴드 단위)과 한 번에 처리한 결과가 같다", () => {
    const W = 37, H = 29, W2 = 11, H2 = 7;
    const px = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < px.length; i++) px[i] = (i * 2654435761) >>> 24;
    const a = areaDownsample(px, W, H, W2, H2);
    const ds = new AreaDownsampler(W, H, W2, H2);
    for (let j = 0; j < H; j++) ds.pushRow(px.subarray(j * W * 4, (j + 1) * W * 4), j);
    expect([...ds.out]).toEqual([...a]);
  });
  it("est / fmtBytes 골든", () => {
    expect(estimateBytes(850000, 2048 * 1365, 6000 * 4000, "jpeg", 12000)).toBe(5897627);
    expect(estimateBytes(850000, 2048 * 1365, 2048 * 1365, "jpeg", 12000)).toBe(862000);
    expect(estimateBytes(4200000, 2048 * 1365, 6000 * 4000, "png", 12000)).toBe(32394509);
    expect(fmtBytes(999499)).toBe("약 999 KB");
    expect(fmtBytes(999500)).toBe("약 1.0 MB");
    expect(fmtBytes(12345678)).toBe("약 12.3 MB");
    expect(fmtBytes(400)).toBe("약 1 KB");
    expect(fmtActualBytes(2_345_678)).toBe("2.35 MB");
    expect(fmtActualBytes(812_345)).toBe("812 KB");
  });
  it("exportName 골든", () => {
    const d = new Date(2026, 9, 16, 6, 39, 5);
    expect(exportName("DSCF0001.RAF", "fuji-classic-chrome", d, "jpg")).toBe("DSCF0001_fuji-classic-chrome_20261016_063905.jpg");
    expect(exportName("my trip: day*1.HEIC", null, d, "png")).toBe("my_trip_day_1_nofilm_20261016_063905.png");
    expect(exportName(".mp4", "fuji-provia", d, "mp4")).toBe("filmlab_fuji-provia_20261016_063905.mp4");
    expect(Array.from(exportName("가".repeat(100) + ".jpg", null, d, "jpg").split("_nofilm")[0]!).length).toBe(60);
  });
  it("메모리 계획: 분기와 문구 조건", () => {
    const MB = 2 ** 20;
    // 원본 크기: need = W·H·4·2 + est (6000×4000×8 = 192,000,000 + est), 한도 0.8·budget
    const a = photoMemoryPlan(6000, 4000, 6000, 4000, 5e6, 320 * MB);
    expect(a.need).toBe(197_000_000);
    expect(a.fits).toBe(true); // 0.8·320MiB = 268,435,456
    expect(photoMemoryPlan(6000, 4000, 6000, 4000, 5e6, 200 * MB).fits).toBe(false);
    // 축소: need = W·1024·4 + W2·H2·4·2 + est
    const b = photoMemoryPlan(6000, 4000, 2048, 1365, 1e6, 320 * MB);
    expect(b.need).toBe(6000 * 1024 * 4 + 2048 * 1365 * 8 + 1e6);
  });
  it("planPhoto: 원본 불가·2048 불가 분기", () => {
    const asset = { displaySize: { width: 8000, height: 6000 } };
    const small = planPhoto(asset, { format: "jpeg", mode: "original", size: "full", quality: 90 }, 1e7, 128 * 2 ** 20);
    expect(small.fits).toBe(false);
    expect(small.hopeless).toBe(false);
    const tiny = planPhoto(asset, { format: "jpeg", mode: "compress", size: 2048, quality: 90 }, 1e7, 8 * 2 ** 20);
    expect(tiny.hopeless).toBe(true);
    const ok = planPhoto({ displaySize: { width: 3000, height: 2000 } }, { format: "png", mode: "original", size: "full", quality: 90 }, 1e7, 1024 * 2 ** 20);
    expect(ok.fits).toBe(true);
    expect([ok.W2, ok.H2]).toEqual([3000, 2000]);
    expect(exifSegmentLength({ exif: null })).toBe(0);
  });
});

describe("T15 동영상 계획", () => {
  it("video1080 골든", () => {
    expect(video1080(3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(video1080(2160, 3840)).toEqual({ width: 1080, height: 1920 });
    expect(video1080(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(video1080(4096, 2160)).toEqual({ width: 2048, height: 1080 });
    expect(video1080(1440, 1080)).toEqual({ width: 1440, height: 1080 });
    expect(has1080Option(1920, 1080)).toBe(false);
    expect(has1080Option(3840, 2160)).toBe(true);
  });
  it("비트레이트 골든", () => {
    expect(videoBitrate(3840, 2160, 60)).toBe(49766400);
    expect(videoBitrate(1920, 1080, 30)).toBe(6220800);
    expect(videoBitrate(640, 360, 30)).toBe(4000000);
    expect(videoBitrate(7680, 4320, 60)).toBe(100000000);
  });
  it("fps 계획", () => {
    expect(fpsPlan(120)).toEqual({ fpsOut: 60, resample: true });
    expect(fpsPlan(60)).toEqual({ fpsOut: 60, resample: false });
    expect(fpsPlan(60.4)).toEqual({ fpsOut: 60, resample: false });
    expect(fpsPlan(29.97)).toEqual({ fpsOut: 29.97, resample: false });
    expect(fpsLine(120, 60)).toBe("60 fps (원본 120 fps)");
    expect(fpsLine(30, 30)).toBe("30 fps");
  });
  it("회전·반전 → orientation 대조표", () => {
    const T: Array<[number, boolean, number]> = [[0, false, 1], [90, false, 6], [180, false, 3], [270, false, 8], [0, true, 2], [90, true, 5], [180, true, 4], [270, true, 7]];
    for (const [r, f, o] of T) expect(rotationToOrientation(r, f)).toBe(o);
  });
  it("회전·반전 → Step 3 tkhd 행렬 표와 같은 orientation (QuickTime x' = a·x + c·y)", () => {
    const M: Array<[number, boolean, number[]]> = [
      [0, false, [1, 0, 0, 1]], [90, false, [0, 1, -1, 0]], [180, false, [-1, 0, 0, -1]], [270, false, [0, -1, 1, 0]],
      [0, true, [-1, 0, 0, 1]], [90, true, [0, 1, 1, 0]], [180, true, [1, 0, 0, -1]], [270, true, [0, -1, -1, 0]],
    ];
    for (const [r, f, m] of M) expect(orientationFromMatrix(m[0]! * 65536, m[1]! * 65536, m[2]! * 65536, m[3]! * 65536).orientation).toBe(rotationToOrientation(r, f));
  });
  const caps = (o: Partial<{ dec: boolean; enc: string[]; sup: string[]; cfg: boolean }>): AudioCaps => ({
    canDecode: o.dec ?? false, canEncode: (c) => (o.enc ?? []).includes(c), containerSupports: (c) => (o.sup ?? []).includes(c), hasDecoderConfig: o.cfg ?? true,
  });
  it("audioPlan 결정표", () => {
    expect(audioPlan("mp4", "aac", caps({ dec: true, enc: ["aac"], sup: ["aac"] }))).toMatchObject({ mode: "copy", warning: null });
    expect(audioPlan("mp4", "pcm-s16", caps({ dec: true, enc: ["aac"], sup: ["pcm-s16", "aac"] }))).toMatchObject({ mode: "transcode", codec: "aac", warning: null });
    expect(audioPlan("mp4", "pcm-s16", caps({ dec: true, enc: [], sup: ["pcm-s16", "aac"] }))).toMatchObject({ mode: "copy", warning: "일부 기기 사진첩에서 소리가 재생되지 않을 수 있습니다" });
    expect(audioPlan("mp4", "opus", caps({ dec: false, sup: ["opus", "aac"] }))).toMatchObject({ mode: "copy", warning: "일부 기기 사진첩에서 소리가 재생되지 않을 수 있습니다" });
    expect(audioPlan("mp4", null, caps({ dec: false }))).toMatchObject({ mode: "none", warning: "원본 오디오를 담을 수 없어 소리 없이 저장됩니다" });
    expect(audioPlan("webm", "aac", caps({ dec: true, enc: ["opus"], sup: ["opus", "vorbis"] }))).toMatchObject({ mode: "transcode", codec: "opus", warning: null });
    expect(audioPlan("webm", "aac", caps({ dec: false, sup: ["opus", "vorbis"] }))).toMatchObject({ mode: "none", warning: "원본 오디오를 담을 수 없어 소리 없이 저장됩니다" });
    expect(audioPlan("webm", "opus", caps({ dec: false, sup: ["opus"] }))).toMatchObject({ mode: "copy" });
    expect(audioPlan("mp4", "aac", caps({ dec: false, cfg: false }))).toMatchObject({ mode: "none" }); // 디코더 설정이 없으면 복사하지 않는다
  });
  it("코덱 선택 순서와 형식 줄", async () => {
    const mk = (avail: string[], rec = false) => ({ firstEncodable: async (c: string[]) => (c.find((x) => avail.includes(x)) ?? null) as never, hasMediaRecorder: rec });
    expect(await pickContainerCodec(mk(["avc", "vp9"]))).toEqual({ container: "mp4", codec: "avc" });
    expect(await pickContainerCodec(mk(["hevc"]))).toEqual({ container: "mp4", codec: "hevc" });
    expect(await pickContainerCodec(mk(["vp8"]))).toEqual({ container: "webm", codec: "vp8" });
    expect(await pickContainerCodec(mk([], true))).toEqual({ container: "recorder", codec: null });
    expect(await pickContainerCodec(mk([], false))).toEqual({ container: "none", codec: null });
    expect(formatLine({ container: "mp4", codec: "avc" }, { mode: "copy", codec: "aac", warning: null })).toBe("MP4 · H.264 · AAC(원본 오디오 복사)");
    expect(formatLine({ container: "mp4", codec: "hevc" }, { mode: "transcode", codec: "aac", warning: null })).toBe("MP4 · HEVC · AAC(변환)");
    expect(formatLine({ container: "webm", codec: "vp9" }, { mode: "transcode", codec: "opus", warning: null })).toBe("WebM · VP9 · Opus(변환)");
    expect(formatLine({ container: "mp4", codec: "avc" }, { mode: "none", codec: null, warning: null })).toBe("MP4 · H.264 · 오디오 없음");
  });
  it("예상 용량·메모리·진행 문구", () => {
    expect(estimateVideoBytes(8e6, { mode: "copy", codec: "aac", warning: null }, null, 10)).toBe(Math.round(((8e6 + 192000) / 8) * 10));
    expect(estimateVideoBytes(8e6, { mode: "none", codec: null, warning: null }, 128000, 10)).toBe(10_000_000);
    expect(videoTooLarge(100, 100)).toBe(true);
    expect(videoTooLarge(30, 100)).toBe(false);
    expect(progressLine(0.01, 5)).toBe("1%");
    expect(progressLine(0.5, 90)).toBe("50% · 남은 시간 약 1분 30초");
  });
  it("실시간 녹화 mimeType 우선순위", () => {
    expect(pickRecorderMime((t) => t === "video/mp4")).toBe("video/mp4");
    expect(pickRecorderMime((t) => t.startsWith("video/webm"))).toBe('video/webm;codecs="vp9,opus"');
    expect(pickRecorderMime(() => false)).toBeNull();
  });
});

// ── 인코드 ────────────────────────────────────────────────────────────────
const gradient = (w: number, h: number) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; d[i] = (x * 255) / (w - 1); d[i + 1] = (y * 255) / (h - 1); d[i + 2] = ((x + y) * 255) / (w + h - 2); d[i + 3] = 255; }
  return d;
};

/** SOF 마커 위치·성분 샘플링 요인 + DQT 값 */
function parseJpeg(b: Uint8Array): { sof: number; samp: number[]; dqt: number[] } {
  let sof = 0; const samp: number[] = []; const dqt: number[] = [];
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1]!;
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
      sof = m;
      const n = b[i + 9]!;
      for (let k = 0; k < n; k++) samp.push(b[i + 11 + k * 3]!);
    }
    if (m === 0xdb) { let p = i + 4; while (p < i + 2 + len) { const pq = b[p]! >> 4; p++; for (let k = 0; k < 64; k++) { dqt.push(pq ? (b[p]! << 8) | b[p + 1]! : b[p]!); p += pq ? 2 : 1; } } }
    if (m === 0xda) break;
    i += 2 + len;
  }
  return { sof, samp, dqt };
}

describe("T16 JPEG 인코드 (mozjpeg WASM, Node)", () => {
  // @vitest-environment node 는 vitest.config 의 기본 environment 와 같다
  beforeAll(async () => {
    const req = createRequire(import.meta.url);
    await initJpeg(await WebAssembly.compile(readFileSync(req.resolve("@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm"))));
  });
  const W = 64, H = 48;
  it("모드 1: SOF2 · 4:4:4 · DQT 전부 1", async () => {
    const out = await encodeJpeg(gradient(W, H), W, H, jpegOptions({ mode: "original", width: W, height: H }));
    const p = parseJpeg(out);
    expect(p.sof).toBe(0xc2);
    expect(p.samp).toEqual([0x11, 0x11, 0x11]);
    expect(p.dqt.length).toBeGreaterThan(0);
    expect(p.dqt.every((v) => v === 1)).toBe(true);
  });
  it("모드 2: q=80 은 4:2:0 (Y 0x22), q=90 은 4:4:4", async () => {
    const a = parseJpeg(await encodeJpeg(gradient(W, H), W, H, jpegOptions({ mode: "compress", quality: 80, width: W, height: H })));
    expect(a.samp[0]).toBe(0x22);
    const b = parseJpeg(await encodeJpeg(gradient(W, H), W, H, jpegOptions({ mode: "compress", quality: 90, width: W, height: H })));
    expect(b.samp[0]).toBe(0x11);
  });
  it("progressive=false 면 SOF0", async () => {
    const o = { ...jpegOptions({ mode: "compress", quality: 90, width: W, height: H }), progressive: false };
    expect(parseJpeg(await encodeJpeg(gradient(W, H), W, H, o)).sof).toBe(0xc0);
  });
  it("progressive 는 W2·H2 ≤ 30,000,000 일 때만", () => {
    expect(jpegOptions({ mode: "original", width: 6000, height: 4000 }).progressive).toBe(true);
    expect(jpegOptions({ mode: "original", width: 6000, height: 5001 }).progressive).toBe(false);
  });
});

describe("T17 PNG 인코드", () => {
  it("RGB 8비트 왕복이 바이트 단위로 같다", () => {
    const W = 33, H = 17;
    const rgba = gradient(W, H);
    const png = encodePng(rgba, W, H);
    const d = decodePng(png);
    expect([d.width, d.height, d.channels, d.depth]).toEqual([W, H, 3, 8]);
    const rgb = new Uint8Array(W * H * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4) { rgb[j++] = rgba[i]!; rgb[j++] = rgba[i + 1]!; rgb[j++] = rgba[i + 2]!; }
    expect([...(d.data as Uint8Array)]).toEqual([...rgb]);
  });
});

describe("T18 EXIF 재삽입", () => {
  beforeAll(async () => {
    const req = createRequire(import.meta.url);
    await initJpeg(await WebAssembly.compile(readFileSync(req.resolve("@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm"))));
  });
  it("Orientation 6 원본 → 출력 Orientation 1, Pixel 크기 64×48, Make·GPS 보존, IFD1 썸네일 없음", async () => {
    const demo = new Uint8Array(readFileSync("public/demo/demo-scene.jpg"));
    // 데모 EXIF 의 Orientation 을 6 으로 바꾼 원본 (JPEG 본문은 그대로)
    const bin = Array.from(demo, (c) => String.fromCharCode(c)).join("");
    const ex = piexif.load(bin) as Record<string, Record<number, unknown>>;
    ex["0th"]![274] = 6;
    const rotated = Uint8Array.from(piexif.insert(piexif.dump(ex), bin), (c) => c.charCodeAt(0));
    const payload = await extractPayload(rotated, "jpeg");
    expect(payload.orientation).toBe(6);
    const out = await encodeJpeg(gradient(64, 48), 64, 48, jpegOptions({ mode: "original", width: 64, height: 48 }));
    const { bytes } = insertExifIntoJpeg(out, payload, { width: 64, height: 48 });
    const rep = await inspectOutputExif(bytes, "jpeg");
    expect(rep.orientation).toBe(1);
    expect([rep.pixelX, rep.pixelY]).toEqual([64, 48]);
    expect(rep.make).toBe("FILM LAB");
    expect(rep.gps).toBe(true);
    expect(rep.hasThumbnail).toBe(false);
    const exifr = (await import("exifr")).default;
    const t = (await exifr.parse(bytes, { gps: true, translateKeys: true, translateValues: false, reviveValues: true, mergeOutput: true } as never)) as Record<string, unknown>;
    expect(t.Orientation).toBe(1);
    expect(t.Make).toBe("FILM LAB");
    expect(t.ExifImageWidth).toBe(64);
    expect(t.ExifImageHeight).toBe(48);
    expect(Number(t.latitude)).toBeGreaterThan(37.56);
  });
});

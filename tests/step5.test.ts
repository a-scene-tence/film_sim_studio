// Step 5: EXIF 필름 프레임, 무음 영상·MP4 우선 녹화, Display P3 출력
import { describe, expect, it } from "vitest";
import { patchTiffBytes } from "../src/lib/exif/serialize";
import { composePhoto, drawFrameText, type TextCtx } from "../src/lib/export/frame-render";
import {
  buildFrameText, defaultFrameOptions, FRAME_COLORS, filmBadgeLabel, fitFontSize, frameBackground, frameGeometry, framedSize, shortDate, shortFocal, shortIso, shortShutter,
} from "../src/lib/export/frame";
import { photoMemoryPlan } from "../src/lib/export/estimate";
import { encoderOptions, framePayload, planPhoto, type PhotoExportOptions } from "../src/lib/export/photo-export";
import { pickRecorderMime, recorderExt, RECORDER_MIME_CANDIDATES, RECORDER_MIME_CANDIDATES_SILENT } from "../src/lib/export/recorder-fallback";
import { audioPlan, NO_AUDIO, planAudioSafe, WARN_W2, type AudioCaps } from "../src/lib/export/video-plan";
import { concat, fromAscii, writeU16be, writeU32be } from "../src/lib/media/binary";
import { parseEbml } from "../src/lib/media/ebml";
import { parseMoov } from "../src/lib/media/video-probe";
import { displayIsP3, glSupportsP3, p3Available, parseOutputSpace, srgbToP3Matrix, srgbToP3Uniform } from "../src/lib/render/output-space";
import { assembleFragment } from "../src/lib/render/glsl";
import { fixtureTiff } from "./helpers/fixture";

const SUMMARY = {
  body: "FUJIFILM X-T5", lens: "XF35mmF1.4 R", focalLength: "35mm (35mm 환산 52.5mm)", aperture: "f/1.4", shutter: "1/250", iso: "ISO 400", dateTime: "2026.10.16 06:39:00 +09:00",
};

describe("Step 5-1 프레임 레이아웃", () => {
  it("기본값은 OFF / 화이트 / 하단 여백형", () => {
    expect(defaultFrameOptions()).toEqual({ enabled: false, theme: "white", layout: "bottom" });
  });
  it("하단 여백형: 가로 불변, 아래에만 바가 붙고 왼쪽 정렬", () => {
    const g = frameGeometry(6000, 4000, "bottom");
    expect([g.width, g.photoX, g.photoY, g.align]).toEqual([6000, 0, 0, "left"]);
    expect(g.height).toBe(4000 + g.bar.height);
    expect(g.bar).toMatchObject({ x: 0, y: 4000, width: 6000 });
    expect(g.height % 2 === 0 && g.bar.height % 2 === 0).toBe(true);
  });
  it("폴라로이드형: 4면 여백 + 더 두꺼운 하단, 가운데 정렬", () => {
    const g = frameGeometry(6000, 4000, "polaroid");
    const b = g.photoX;
    expect(b).toBeGreaterThan(0);
    expect(g.photoY).toBe(b);
    expect(g.width).toBe(6000 + 2 * b);
    expect(g.bar.height).toBeGreaterThan(b);
    expect(g.height).toBe(4000 + b + g.bar.height);
    expect(g.bar.y).toBe(b + 4000);
    expect(g.align).toBe("center");
  });
  it("세로 사진은 짧은 변 기준으로 같은 비율", () => {
    expect(frameGeometry(4000, 6000, "bottom").bar.height).toBe(frameGeometry(6000, 4000, "bottom").bar.height);
  });
  it("framedSize: OFF 면 원래 크기", () => {
    expect(framedSize(300, 200, defaultFrameOptions())).toEqual({ width: 300, height: 200 });
    const on = framedSize(300, 200, { enabled: true, theme: "dark", layout: "bottom" });
    expect(on.width).toBe(300);
    expect(on.height).toBeGreaterThan(200);
  });
  it("composePhoto: 배경 채움 + 사진 픽셀 위치 보존", () => {
    const W = 4, H = 2;
    const photo = new Uint8ClampedArray(W * H * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 251));
    const g = frameGeometry(W, H, "polaroid");
    const out = composePhoto(photo, W, H, g, "dark");
    expect(out.length).toBe(g.width * g.height * 4);
    const [r, gg, b] = frameBackground("dark");
    expect(Array.from(out.subarray(0, 4))).toEqual([r, gg, b, 255]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = ((g.photoY + y) * g.width + g.photoX + x) * 4;
      expect(Array.from(out.subarray(o, o + 4))).toEqual(Array.from(photo.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)));
    }
  });
});

describe("Step 5-1 각인 문구", () => {
  it("1줄 바디·렌즈, 2줄 초점거리·조리개·셔터·ISO·일시", () => {
    const t = buildFrameText(SUMMARY, "FUJIFILM Classic Neg.");
    expect(t.main).toBe("FUJIFILM X-T5  ·  XF35mmF1.4 R");
    expect(t.sub).toBe("35mm  ·  f/1.4  ·  1/250s  ·  ISO 400  ·  2026.10.16 06:39");
    expect(t.badge).toBe("FUJIFILM Classic Neg.");
  });
  it("정보가 없으면 항목을 빼고, 바디도 없으면 Film Lab", () => {
    expect(buildFrameText({ body: null, lens: null, iso: "ISO 100" }, "x")).toEqual({ main: "Film Lab", sub: "ISO 100", badge: "x" });
    expect(buildFrameText(null, "x").sub).toBe("");
  });
  it("포맷터: 환산 제거, 초 단위 셔터, 파일 수정 시각은 각인하지 않음", () => {
    expect(shortFocal("50mm (35mm 환산 75mm)")).toBe("50mm");
    expect(shortShutter("2.5초")).toBe("2.5s");
    expect(shortShutter("1/8000")).toBe("1/8000s");
    expect(shortIso("400")).toBe("ISO 400");
    expect(shortDate("2026.10.16 06:39:00 (파일 수정 시각)")).toBeNull();
    expect(shortDate("—")).toBeNull();
  });
  it("필름 배지: FUJIFILM / RICOH + HDF", () => {
    expect(filmBadgeLabel({ brand: "fujifilm", en: "Classic Neg." }, false)).toBe("FUJIFILM Classic Neg.");
    expect(filmBadgeLabel({ brand: "ricoh", en: "Positive Film" }, true)).toBe("RICOH Positive Film + HDF");
    expect(filmBadgeLabel({ brand: "fujifilm", en: "FUJIFILM Acros" }, false)).toBe("FUJIFILM Acros");
    expect(filmBadgeLabel(null, false)).toBe("Original");
  });
  it("fitFontSize: 폭에 맞을 때까지 줄이고 6px 아래로 내려가지 않는다", () => {
    expect(fitFontSize(20, 100, (px) => px * 10)).toBe(10);
    expect(fitFontSize(20, 1000, (px) => px * 10)).toBe(20);
    expect(fitFontSize(20, 1, (px) => px * 10)).toBe(6);
  });
  it("drawFrameText: 1줄 바디·렌즈, 2줄 정보와 배지를 그린다 (목 컨텍스트)", () => {
    const calls: Array<{ t: string; x: number; y: number; fill: unknown }> = [];
    const ctx: TextCtx = {
      font: "", fillStyle: "", textBaseline: "alphabetic", textAlign: "left",
      fillRect() {}, beginPath() {}, closePath() {}, fill() {}, rect() {},
      measureText: (t) => ({ width: t.length * 6 }),
      fillText(t, x, y) { calls.push({ t, x, y, fill: ctx.fillStyle }); },
    };
    const g = frameGeometry(1200, 800, "bottom");
    const text = buildFrameText(SUMMARY, "FUJIFILM Classic Neg.");
    drawFrameText(ctx, g, text, "white");
    expect(calls.map((c) => c.t)).toEqual([text.main, text.sub, text.badge]);
    expect(calls[0]!.fill).toBe(FRAME_COLORS.white.main);
    expect(calls[2]!.fill).toBe(FRAME_COLORS.white.badgeText);
    expect(calls[0]!.y).toBeLessThan(calls[1]!.y);
    expect(calls[2]!.x).toBeGreaterThan(calls[1]!.x);
  });
});

describe("Step 5-1 저장 연결 (EXIF 100% 보존·메모리·옵션)", () => {
  const on: PhotoExportOptions = { format: "jpeg", mode: "original", size: "full", quality: 90, frame: { enabled: true, theme: "white", layout: "polaroid" } };
  it("framePayload: OFF 면 undefined, ON 이면 레이아웃·테마·문구", () => {
    expect(framePayload({ ...on, frame: undefined }, undefined)).toBeUndefined();
    expect(framePayload({ ...on, frame: defaultFrameOptions() }, undefined)).toBeUndefined();
    const p = framePayload(on, { summary: SUMMARY as never, badge: "RICOH Positive Film + HDF" })!;
    expect([p.layout, p.theme, p.text.badge]).toEqual(["polaroid", "white", "RICOH Positive Film + HDF"]);
  });
  it("EXIF PixelDimension 은 프레임 포함 크기로 갱신되고 나머지 원본 EXIF 바이트는 그대로", () => {
    const f = framedSize(8, 16, on.frame!);
    const src = fixtureTiff();
    const out = patchTiffBytes(src, f, []);
    const base = 30;
    expect(out[72 - base]).toBe(1); // Orientation = 1
    expect(out[360 - base]! | (out[361 - base]! << 8)).toBe(f.width);
    expect(out[372 - base]! | (out[373 - base]! << 8)).toBe(f.height);
    const changed = new Set([72, 73, 360, 361, 372, 373].map((o) => o - base));
    for (let i = 0; i < src.length; i++) if (!changed.has(i)) expect(out[i]).toBe(src[i]);
  });
  it("메모리 계획: 프레임을 켜면 필요량이 늘고, 끄면 기존과 같다", () => {
    const asset = { displaySize: { width: 6000, height: 4000 } };
    const off = planPhoto(asset, { ...on, frame: undefined }, 1e7, 1024 * 2 ** 20);
    const withFrame = planPhoto(asset, on, 1e7, 1024 * 2 ** 20);
    expect(withFrame.need).toBeGreaterThan(off.need);
    expect(off.need).toBe(photoMemoryPlan(6000, 4000, 6000, 4000, 1e7, 1024 * 2 ** 20).need);
    expect(withFrame.H2).toBeGreaterThan(4000);
  });
  it("JPEG 옵션은 프레임 포함 크기로 progressive 를 판단한다", () => {
    const big = encoderOptions({ ...on, frame: { enabled: true, theme: "dark", layout: "bottom" } }, 7000, 4285) as { progressive: boolean };
    const plain = encoderOptions({ ...on, frame: undefined }, 7000, 4285) as { progressive: boolean };
    expect(plain.progressive).toBe(true); // 29,995,000 px
    expect(big.progressive).toBe(false); // 프레임으로 3천만 화소 초과
  });
});

describe("Step 5-2 무음 영상·MP4 우선", () => {
  const box = (type: string, ...payload: Uint8Array[]) => { const p = concat(payload); return concat([writeU32be(8 + p.length), fromAscii(type), p]); };
  const full = (type: string, ...payload: Uint8Array[]) => box(type, new Uint8Array(4), ...payload);
  const videoOnlyMoov = () => {
    const head = new Uint8Array(78);
    head.set(writeU16be(1920), 24); head.set(writeU16be(1080), 26);
    const entry = box("avc1", head, box("avcC", Uint8Array.of(1, 0x64, 0x00, 0x33, 0xff)));
    return box("moov", box("trak", box("mdia",
      full("mdhd", writeU32be(0), writeU32be(0), writeU32be(60000), writeU32be(600000)),
      full("hdlr", writeU32be(0), fromAscii("vide"), new Uint8Array(13)),
      box("minf", box("stbl", full("stsd", writeU32be(1), entry), full("stts", writeU32be(1), writeU32be(120), writeU32be(1001)), full("stsz", writeU32be(0), writeU32be(1), writeU32be(4096)), full("stco", writeU32be(1), writeU32be(48)))),
    )));
  };
  it("오디오 트랙이 없는 MP4 도 오류 없이 열린다 (hasAudio=false)", () => {
    const p = parseMoov(videoOnlyMoov());
    expect(p.hasAudio).toBe(false);
    expect([p.audioCodec, p.audioSampleRate]).toEqual([null, null]);
    expect([p.width, p.height, p.codec]).toEqual([1920, 1080, "avc1.640033"]);
  });
  it("오디오 트랙이 없는 WebM 도 오류 없이 열린다", () => {
    const el = (id: number[], ...payload: Uint8Array[]) => {
      const p = concat(payload); const n = p.length;
      return concat([Uint8Array.from(id), Uint8Array.of(0x10 | ((n >>> 24) & 0x0f), (n >>> 16) & 255, (n >>> 8) & 255, n & 255), p]);
    };
    const track = el([0xae], el([0x83], Uint8Array.of(1)), el([0x86], fromAscii("V_VP9")), el([0xe0], el([0xb0], writeU16be(1280)), el([0xba], writeU16be(720))));
    const bytes = concat([el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], fromAscii("webm"))), el([0x18, 0x53, 0x80, 0x67], el([0x16, 0x54, 0xae, 0x6b], track))]);
    const r = parseEbml(bytes);
    expect([r.width, r.height, r.hasAudio, r.audioCodec]).toEqual([1280, 720, false, null]);
  });
  it("planAudioSafe: 트랙 없음 → 경고 없는 비디오 전용, 탐지 실패 → 소리 없이 저장(거부 안 함)", async () => {
    let probed = false;
    const none = await planAudioSafe(false, "mp4", async () => { probed = true; throw new Error("호출되면 안 됨"); });
    expect(none).toEqual(NO_AUDIO);
    expect(probed).toBe(false);
    const failed = await planAudioSafe(true, "mp4", async () => { throw new Error("지원하지 않는 오디오 코덱"); });
    expect(failed).toMatchObject({ mode: "none", warning: WARN_W2 });
    const caps: AudioCaps = { canDecode: true, canEncode: (c) => c === "aac", containerSupports: () => true, hasDecoderConfig: true };
    expect(await planAudioSafe(true, "mp4", async () => ({ codec: "aac", caps }))).toEqual(audioPlan("mp4", "aac", caps));
  });
  it("MediaRecorder 후보: MP4(avc1+aac → hvc1 → mp4) 가 WebM 보다 먼저", () => {
    expect(RECORDER_MIME_CANDIDATES.slice(0, 3)).toEqual(["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4;codecs=hvc1", "video/mp4"]);
    expect(RECORDER_MIME_CANDIDATES.findIndex((t) => t.includes("webm"))).toBeGreaterThan(2);
    expect(RECORDER_MIME_CANDIDATES_SILENT[0]).toBe("video/mp4;codecs=avc1");
  });
  it("pickRecorderMime: 지원하는 첫 MP4, MP4 가 전혀 없을 때만 WebM, 확장자 매핑", () => {
    expect(pickRecorderMime(() => true)).toBe("video/mp4;codecs=avc1,mp4a.40.2");
    expect(pickRecorderMime((t) => t === "video/mp4;codecs=hvc1" || t.startsWith("video/webm"))).toBe("video/mp4;codecs=hvc1");
    expect(pickRecorderMime((t) => t === "video/mp4")).toBe("video/mp4");
    const webm = pickRecorderMime((t) => t.startsWith("video/webm"))!;
    expect(webm.startsWith("video/webm")).toBe(true);
    expect(pickRecorderMime(() => false)).toBeNull();
    expect(pickRecorderMime(() => true, false)).toBe("video/mp4;codecs=avc1");
    expect(recorderExt("video/mp4;codecs=avc1,mp4a.40.2")).toBe("mp4");
    expect(recorderExt("video/mp4")).toBe("mp4");
    expect(recorderExt('video/webm;codecs="vp9,opus"')).toBe("webm");
  });
});

describe("Step 5-3 Display P3 출력", () => {
  it("기본값·잘못된 값은 sRGB", () => {
    expect(parseOutputSpace(undefined)).toBe("srgb");
    expect(parseOutputSpace("junk")).toBe("srgb");
    expect(parseOutputSpace("display-p3")).toBe("display-p3");
  });
  it("sRGB→P3 행렬: 백색·검정 불변, 행 합 1, sRGB 원색은 P3 안쪽", () => {
    const m = srgbToP3Matrix();
    for (const row of m) expect(row[0] + row[1] + row[2]).toBeCloseTo(1, 4);
    const red = [m[0][0], m[1][0], m[2][0]];
    expect(red[0]).toBeGreaterThan(0.8);
    expect(red[0]).toBeLessThan(1);
    expect(red.every((v) => v >= -1e-6)).toBe(true); // P3 ⊃ sRGB
    // 잘 알려진 값: sRGB→P3 (R 열) ≈ [0.8225, 0.0332, 0.0171]
    expect(red[0]).toBeCloseTo(0.8225, 3);
    expect(red[1]).toBeCloseTo(0.0332, 3);
    expect(red[2]).toBeCloseTo(0.0171, 3);
  });
  it("uniform 은 열 우선 9개", () => {
    const u = srgbToP3Uniform();
    const m = srgbToP3Matrix();
    expect(u.length).toBe(9);
    expect(u[1]).toBeCloseTo(m[1][0], 6);
    expect(u[3]).toBeCloseTo(m[0][1], 6);
  });
  it("지원 탐지: matchMedia(color-gamut: p3) 와 drawingBufferColorSpace 가 모두 필요", () => {
    const yes = { matchMedia: (q: string) => ({ matches: q === "(color-gamut: p3)" }) };
    const no = { matchMedia: () => ({ matches: false }) };
    expect(displayIsP3(yes)).toBe(true);
    expect(displayIsP3(no)).toBe(false);
    expect(displayIsP3({})).toBe(false);
    const gl = { drawingBufferColorSpace: "srgb" };
    expect(glSupportsP3(gl)).toBe(true);
    expect(gl.drawingBufferColorSpace).toBe("srgb"); // 탐지 후 원복
    expect(glSupportsP3({})).toBe(false);
    expect(glSupportsP3(null)).toBe(false);
    const stuck = Object.defineProperty({}, "drawingBufferColorSpace", { get: () => "srgb", set: () => undefined });
    expect(glSupportsP3(stuck)).toBe(false);
    expect(p3Available(gl, yes)).toBe(true);
    expect(p3Available(gl, no)).toBe(false);
    expect(p3Available({}, yes)).toBe(false);
  });
  it("final 셰이더: 변환은 uOutConv 가 켜질 때만, 디더 앞에서 적용 (기본 경로는 정본과 동일)", () => {
    const src = assembleFragment("final");
    expect(src).toContain("uniform bool uOutConv;");
    expect(src).toContain("uniform mat3 uOutM;");
    const conv = src.indexOf("if (uOutConv)");
    const dither = src.indexOf("if (uDither)");
    expect(conv).toBeGreaterThan(0);
    expect(conv).toBeLessThan(dither);
    expect(src).toContain("outColor = vec4(v, 1.0);");
  });
});

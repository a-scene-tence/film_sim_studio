import { decode } from "fast-png";
import type { ParseResult, ParsedLut } from "./types";

function emptyLut(): ParsedLut {
  return {
    size: 0,
    data: new Float32Array(0),
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    inVideoRange: false,
    outVideoRange: false,
    warnings: [],
  };
}

function fail(msg: string): ParseResult {
  return { lut: emptyLut(), errors: [msg] };
}

/**
 * HaldCLUT PNG 파서. 레벨 L (2~8), 이미지 L³×L³, 3D 크기 N = L².
 * 픽셀 인덱스 i = y·W + x 가 그대로 3D 인덱스(red fastest)다.
 */
export function parseHald(bytes: Uint8Array): ParseResult {
  let png;
  try {
    png = decode(bytes);
  } catch (e) {
    return fail(`PNG 디코딩 실패: ${e instanceof Error ? e.message : String(e)} — 손상되지 않은 PNG 파일인지 확인하세요.`);
  }
  if (png.palette !== undefined) return fail("팔레트 PNG는 Hald로 사용할 수 없습니다");
  const { width, height, channels, depth, data } = png;
  if (width !== height) return fail(`Hald 이미지는 정사각형이어야 합니다 (현재 ${width}×${height})`);
  let L = 0;
  for (let l = 2; l <= 8; l++) if (l * l * l === width) L = l;
  if (L === 0) return fail(`Hald 이미지 한 변은 L³ (L = 2~8: 8, 27, 64, 125, 216, 343, 512) 이어야 합니다 (현재 ${width})`);
  if (channels !== 3 && channels !== 4) return fail(`Hald 는 RGB(3채널) 또는 RGBA(4채널) PNG 만 지원합니다 (현재 ${channels}채널) — 컬러 PNG 로 다시 저장하세요.`);
  if (depth !== 8 && depth !== 16) return fail(`지원하지 않는 비트 깊이입니다: ${depth} (8 또는 16만 지원)`);
  const scale = depth === 8 ? 255 : 65535;
  const N = L * L;
  const count = width * height;
  if (data.length !== count * channels) return fail(`픽셀 데이터 길이 불일치: 기대 ${count * channels}, 실제 ${data.length}`);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    out[i * 3] = (data[i * channels] ?? 0) / scale;
    out[i * 3 + 1] = (data[i * channels + 1] ?? 0) / scale;
    out[i * 3 + 2] = (data[i * channels + 2] ?? 0) / scale;
  }
  return { lut: { ...emptyLut(), size: N, data: out }, errors: [] };
}

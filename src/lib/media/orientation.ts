/** 10.2 방향 매핑. 원본 W×H, o∈{5,6,7,8} 이면 출력은 H×W. */
export interface Rect { x: number; y: number; width: number; height: number }

export function orientedSize(o: number, W: number, H: number): { width: number; height: number } {
  return o >= 5 && o <= 8 ? { width: H, height: W } : { width: W, height: H };
}

/** 출력 픽셀 (x', y') 의 원본 좌표 */
export function outputToSource(o: number, W: number, H: number, xp: number, yp: number): [number, number] {
  switch (o) {
    case 2: return [W - 1 - xp, yp];
    case 3: return [W - 1 - xp, H - 1 - yp];
    case 4: return [xp, H - 1 - yp];
    case 5: return [yp, xp];
    case 6: return [yp, H - 1 - xp];
    case 7: return [W - 1 - yp, H - 1 - xp];
    case 8: return [W - 1 - yp, xp];
    default: return [xp, yp];
  }
}

/** 표시 rect → 원본 rect */
export function displayRectToSource(o: number, W: number, H: number, r: Rect): Rect {
  const { x, y, width: w, height: h } = r;
  switch (o) {
    case 2: return { x: W - x - w, y, width: w, height: h };
    case 3: return { x: W - x - w, y: H - y - h, width: w, height: h };
    case 4: return { x, y: H - y - h, width: w, height: h };
    case 5: return { x: y, y: x, width: h, height: w };
    case 6: return { x: y, y: H - x - w, width: h, height: w };
    case 7: return { x: W - y - h, y: H - x - w, width: h, height: w };
    case 8: return { x: W - y - h, y: x, width: h, height: w };
    default: return { x, y, width: w, height: h };
  }
}

/** channels 인터리브 배열에 방향을 적용한다 (행 우선). */
export function applyOrientation<T extends { length: number; [i: number]: number }>(
  src: T, W: number, H: number, o: number, channels: number, make: (n: number) => T,
): { data: T; width: number; height: number } {
  const { width, height } = orientedSize(o, W, H);
  const out = make(width * height * channels);
  for (let yp = 0; yp < height; yp++) {
    for (let xp = 0; xp < width; xp++) {
      const [sx, sy] = outputToSource(o, W, H, xp, yp);
      const si = (sy * W + sx) * channels;
      const di = (yp * width + xp) * channels;
      for (let c = 0; c < channels; c++) out[di + c] = src[si + c]!;
    }
  }
  return { data: out, width, height };
}

/** LibRaw flip → EXIF Orientation (9.3). 매핑 밖이면 null. */
export function flipToOrientation(flip: number): number | null {
  switch (flip) {
    case 0: return 1;
    case 3: return 3;
    case 5: return 8;
    case 6: return 6;
    default: return null;
  }
}

/** 캔버스 setTransform 인자 (연속 좌표, 원본 W×H → 표시). 메인/워커의 ImageBitmap 방향 보정용. */
export function canvasTransform(o: number, W: number, H: number): [number, number, number, number, number, number] {
  switch (o) {
    case 2: return [-1, 0, 0, 1, W, 0];
    case 3: return [-1, 0, 0, -1, W, H];
    case 4: return [1, 0, 0, -1, 0, H];
    case 5: return [0, 1, 1, 0, 0, 0];
    case 6: return [0, 1, -1, 0, H, 0];
    case 7: return [0, -1, -1, 0, H, W];
    case 8: return [0, -1, 1, 0, 0, W];
    default: return [1, 0, 0, 1, 0, 0];
  }
}

import { orientedSize, outputToSource } from "./orientation";

/**
 * 방향이 적용된 표시 좌표 행을 원본 래스터에서 읽는 헬퍼.
 * fillRow(yp, put, stride): 표시 행 yp 의 각 픽셀에 대해 put(원본 픽셀 시작 인덱스(stride 배수 기준 sy*W+sx)*stride, x') 호출.
 */
export function applyOrientationRows(o: number, W: number, H: number) {
  const { width, height } = orientedSize(o, W, H);
  return {
    width,
    height,
    fillRow(yp: number, put: (srcIndex: number, x: number) => void, stride: number): void {
      for (let xp = 0; xp < width; xp++) {
        const [sx, sy] = outputToSource(o, W, H, xp, yp);
        put((sy * W + sx) * stride, xp);
      }
    },
  };
}

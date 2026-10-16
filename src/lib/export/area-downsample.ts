// Step 4 §10-5 선형광 영역 평균 다운샘플 (스트리밍). 워커 안에서 쓴다.
import { srgbDec, srgbEnc } from "../color/fse/engine.mjs";

export type Span = [index: number, weight: number];

/** r = Nin/Nout, 출력 o 의 구간 [o·r, (o+1)·r) 와 겹치는 입력 i 마다 가중치 cov/r (cov > 0) */
export function spans(Nin: number, Nout: number): Span[][] {
  const r = Nin / Nout;
  const out: Span[][] = [];
  for (let o = 0; o < Nout; o++) {
    const a = o * r, b = (o + 1) * r;
    const list: Span[] = [];
    for (let i = Math.floor(a); i < Math.min(Nin, Math.ceil(b)); i++) {
      const cov = Math.min(b, i + 1) - Math.max(a, i);
      if (cov > 0) list.push([i, cov / r]);
    }
    out.push(list);
  }
  return out;
}

let decTable: Float64Array | null = null;
const dec = (): Float64Array => (decTable ??= Float64Array.from({ length: 256 }, (_, k) => srgbDec(k / 255)));

/** 입력 행을 위에서부터 순서대로 pushRow 하면 완성된 출력 행을 인코드해 out 에 쓴다 */
export class AreaDownsampler {
  readonly out: Uint8ClampedArray;
  private hs: Span[][];
  private rowTargets: Array<Array<[o: number, w: number]>>;
  private lastRow: number[];
  private acc = new Map<number, Float64Array>();
  private next = 0;

  constructor(readonly W: number, readonly H: number, readonly W2: number, readonly H2: number) {
    this.out = new Uint8ClampedArray(W2 * H2 * 4);
    this.hs = spans(W, W2);
    const vs = spans(H, H2);
    this.rowTargets = Array.from({ length: H }, () => []);
    this.lastRow = vs.map((l) => (l.length ? l[l.length - 1]![0] : 0));
    vs.forEach((l, o) => { for (const [j, w] of l) this.rowTargets[j]!.push([o, w]); });
  }

  /** rgba = 한 행 (W×4). j 는 0 부터 연속이어야 한다 */
  pushRow(rgba: ArrayLike<number>, j: number): void {
    if (j !== this.next) throw new Error(`입력 행 순서 오류: ${j} (기대 ${this.next})`);
    this.next++;
    const D = dec();
    const { W2 } = this;
    const hrow = new Float64Array(W2 * 3);
    for (let x = 0; x < W2; x++) {
      let r = 0, g = 0, b = 0;
      for (const [i, w] of this.hs[x]!) { r += w * D[rgba[i * 4]!]!; g += w * D[rgba[i * 4 + 1]!]!; b += w * D[rgba[i * 4 + 2]!]!; }
      hrow[x * 3] = r; hrow[x * 3 + 1] = g; hrow[x * 3 + 2] = b;
    }
    for (const [o, w] of this.rowTargets[j]!) {
      let a = this.acc.get(o);
      if (!a) { a = new Float64Array(W2 * 3); this.acc.set(o, a); }
      for (let k = 0; k < a.length; k++) a[k] = a[k]! + w * hrow[k]!;
      if (j === this.lastRow[o]) {
        for (let x = 0; x < W2; x++) {
          const p = (o * W2 + x) * 4;
          for (let c = 0; c < 3; c++) this.out[p + c] = Math.round(Math.min(1, Math.max(0, srgbEnc(a[x * 3 + c]!))) * 255);
          this.out[p + 3] = 255;
        }
        this.acc.delete(o);
      }
    }
  }
}

/** 한 번에 처리하는 편의 함수 (테스트·소형 이미지) */
export function areaDownsample(rgba: ArrayLike<number>, W: number, H: number, W2: number, H2: number): Uint8ClampedArray {
  const ds = new AreaDownsampler(W, H, W2, H2);
  const row = new Uint8ClampedArray(W * 4);
  for (let j = 0; j < H; j++) {
    for (let k = 0; k < W * 4; k++) row[k] = rgba[j * W * 4 + k]!;
    ds.pushRow(row, j);
  }
  return ds.out;
}

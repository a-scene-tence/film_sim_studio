/** §7 .bin 디코더: Uint16 LE, 길이 N³·3, red-fastest → Float32 [0,1] */
export function decodeBinLut(buf: ArrayBuffer, N: number): Float32Array {
  const count = N * N * N * 3;
  if (buf.byteLength !== count * 2) {
    throw new Error(`LUT 바이너리 길이 불일치: 기대 ${count * 2}바이트, 실제 ${buf.byteLength}바이트 — 페이지를 새로고침해 LUT 를 다시 받으세요.`);
  }
  const view = new DataView(buf);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getUint16(i * 2, true) / 65535;
  return out;
}

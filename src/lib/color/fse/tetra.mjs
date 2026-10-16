// §7 사면체 보간 — GLSL 과 같은 6분기 CPU 구현. data 는 길이 N³·3, red-fastest.

/**
 * @param {ArrayLike<number>} data
 * @param {number} N
 * @param {ArrayLike<number>} u [0,1]³ 입력 좌표
 * @returns {[number, number, number]}
 */
export function tetraSample(data, N, u) {
  const n1 = N - 1;
  const pr = Math.min(1, Math.max(0, /** @type {number} */ (u[0]))) * n1;
  const pg = Math.min(1, Math.max(0, /** @type {number} */ (u[1]))) * n1;
  const pb = Math.min(1, Math.max(0, /** @type {number} */ (u[2]))) * n1;
  const ir = Math.min(Math.floor(pr), N - 2);
  const ig = Math.min(Math.floor(pg), N - 2);
  const ib = Math.min(Math.floor(pb), N - 2);
  const fr = pr - ir;
  const fg = pg - ig;
  const fb = pb - ib;
  /** @param {number} dr @param {number} dg @param {number} db */
  const F = (dr, dg, db) => (((ib + db) * N + (ig + dg)) * N + (ir + dr)) * 3;
  const c000 = F(0, 0, 0);
  const c111 = F(1, 1, 1);
  let A;
  let B;
  let w0;
  let w1;
  let w2;
  let w3;
  if (fr > fg) {
    if (fg > fb) {
      A = F(1, 0, 0); B = F(1, 1, 0); w0 = 1 - fr; w1 = fr - fg; w2 = fg - fb; w3 = fb;
    } else if (fr > fb) {
      A = F(1, 0, 0); B = F(1, 0, 1); w0 = 1 - fr; w1 = fr - fb; w2 = fb - fg; w3 = fg;
    } else {
      A = F(0, 0, 1); B = F(1, 0, 1); w0 = 1 - fb; w1 = fb - fr; w2 = fr - fg; w3 = fg;
    }
  } else {
    if (fb > fg) {
      A = F(0, 0, 1); B = F(0, 1, 1); w0 = 1 - fb; w1 = fb - fg; w2 = fg - fr; w3 = fr;
    } else if (fb > fr) {
      A = F(0, 1, 0); B = F(0, 1, 1); w0 = 1 - fg; w1 = fg - fb; w2 = fb - fr; w3 = fr;
    } else {
      A = F(0, 1, 0); B = F(1, 1, 0); w0 = 1 - fg; w1 = fg - fr; w2 = fr - fb; w3 = fb;
    }
  }
  /** @type {[number, number, number]} */
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    out[c] =
      w0 * /** @type {number} */ (data[c000 + c]) +
      w1 * /** @type {number} */ (data[A + c]) +
      w2 * /** @type {number} */ (data[B + c]) +
      w3 * /** @type {number} */ (data[c111 + c]);
  }
  return out;
}

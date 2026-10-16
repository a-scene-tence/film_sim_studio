let table: Uint32Array | null = null;
/** CRC32: 다항식 0xEDB88320, 초기값 0xFFFFFFFF, 최종 XOR 0xFFFFFFFF */
export function crc32(...parts: Uint8Array[]): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = table[(c ^ p[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DataView 기반 읽기 헬퍼. 범위를 벗어나면 RangeError 대신 호출자가 검사하도록 최소한만 제공한다. */
export function dv(b: Uint8Array): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}
export function u16be(b: Uint8Array, o: number): number { return ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0); }
export function u32be(b: Uint8Array, o: number): number { return (((b[o] ?? 0) * 0x1000000) + (((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0))); }
export function u64be(b: Uint8Array, o: number): number { return u32be(b, o) * 0x100000000 + u32be(b, o + 4); }
export function u16le(b: Uint8Array, o: number): number { return (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8); }
export function u32le(b: Uint8Array, o: number): number { return (b[o] ?? 0) + (b[o + 1] ?? 0) * 0x100 + (b[o + 2] ?? 0) * 0x10000 + (b[o + 3] ?? 0) * 0x1000000; }
export function ascii(b: Uint8Array, o: number, n: number): string {
  let s = "";
  const end = Math.min(b.length, o + n);
  for (let i = o; i < end; i++) s += String.fromCharCode(b[i]!);
  return s;
}
export function matches(b: Uint8Array, o: number, sig: ArrayLike<number>): boolean {
  for (let i = 0; i < sig.length; i++) if (b[o + i] !== sig[i]) return false;
  return true;
}
export function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function writeU16be(n: number): Uint8Array { return Uint8Array.of((n >>> 8) & 255, n & 255); }
export function writeU32be(n: number): Uint8Array { return Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255); }
export function fromAscii(s: string): Uint8Array {
  const o = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i) & 255;
  return o;
}
export function extOf(name: string): string {
  const m = /\.([^.\\/]+)$/.exec(name);
  return m ? m[1]!.toLowerCase() : "";
}

// Step 4 §10-8 타일 격자: 행 우선, 한 변 최대 T(기본 1024)
export interface Tile { x: number; y: number; w: number; h: number }

export function tileGrid(W: number, H: number, T = 1024): Tile[] {
  const out: Tile[] = [];
  for (let j = 0; j * T < H; j++) for (let i = 0; i * T < W; i++) out.push({ x: i * T, y: j * T, w: Math.min(T, W - i * T), h: Math.min(T, H - j * T) });
  return out;
}

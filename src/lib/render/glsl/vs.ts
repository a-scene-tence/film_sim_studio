// docs/RENDERER.md 섹션 6 vs.glsl (정점 셰이더, 단독 사용) — 글자 그대로 옮긴 정본. 수정 금지.
export const VS_GLSL = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

// Step 4 §5-5 fs_hist — 최종 표시 인코딩 이미지를 히스토그램용으로 다운샘플 복사한다.
export const FS_HIST_GLSL = `// ===== fs_hist : downsample final display-encoded image for the histogram =====
uniform sampler2D uIn;
out vec4 outColor;
void main() { outColor = vec4(texture(uIn, uvLocal()).rgb, 1.0); }
`;

# RENDERER.md — Step 3 WebGL2 멀티패스 렌더러 명세

이 문서는 Step 3 프롬프트의 섹션 4, 5, 7~14 를 글자 그대로 옮긴 것이다. 섹션 번호는 원문을 따른다. 섹션 6(GLSL 정본)은 파일 경로 목록만 적는다. 색 수식의 진실 원천은 docs/COLOR_SCIENCE.md 이다. 원문과 다르게 처리한 부분은 맨 끝 "구현 노트"에 모두 기록한다.

## 4. 파이프라인과 GPU 규약
### 4.1 처리 순서 (사진·비디오·타일 공통)
S0 소스→WS: 디코드 → M_src→WS → Samsung 피부 보정 → 소프트 색역 압축 → 하이라이트 롤오프 → 화이트밸런스(Bradford) → 노출 2^EV
S1 HDF 이중 반경 광학 확산
S2 디헤이즈
S3 베이스 레이어 톤(라이트 밸런스, 쉐도우, 하이라이트, 흰색, 검정, 밝기)
S4 대비
S5 비네팅 cos⁴θ(장면 선형)
S6 음수 제거
S7 필름 3D LUT(사면체) 또는 원본(T_ref) 또는 외부 Look LUT
S8 컬러 크롬 이펙트 / FX 블루
S9 톤 커브(256×1)
S10 채도/생동감
S11 명료도
S12 선명도(언샵 마스크)
S13 그레인
S14 디더·출력
### 4.2 GPU 규약
1. 컨텍스트: canvas.getContext("webgl2", { alpha:false, antialias:false, depth:false, stencil:false, premultipliedAlpha:false, preserveDrawingBuffer:false, powerPreference:"high-performance" })
   - 없으면 오류 UNSUPPORTED_WEBGL2("이 브라우저는 WebGL2 를 지원하지 않습니다")
2. 확장
   - EXT_color_buffer_float 우선. 없으면 EXT_color_buffer_half_float(이때 RG32F 대신 RG16F 사용, 경고 기록). 둘 다 없으면 UNSUPPORTED_FLOAT_RENDER.
   - OES_texture_float_linear 는 사용하지 않는다(필터링 대상은 전부 16F).
3. 좌표: 모든 텍스처의 행 0 = 이미지 윗줄이다. 업로드 시 UNPACK_FLIP_Y_WEBGL=false. 프래그먼트는 gl_FragCoord.xy/크기를 uv 로 쓴다. 기본 프레임버퍼(캔버스) 출력 패스에서만 uFlipY=true.
4. 업로드 공통: UNPACK_PREMULTIPLY_ALPHA_WEBGL=false, UNPACK_COLORSPACE_CONVERSION_WEBGL=NONE, UNPACK_ALIGNMENT=1
5. mat3 유니폼: uniformMatrix3fv(loc, false, 열 우선 9개). 셰이더에서 x' = M * x 가 행렬식 M·x 와 같아야 한다.
6. 형식표 (전부 CLAMP_TO_EDGE)
   - uSrc(사진 프록시): RGBA16F ← Float32 업로드(type FLOAT), LINEAR
   - uSrc(비디오): RGBA16F/HALF_FLOAT 업로드가 오류 없으면 그것, 아니면 RGBA8. LINEAR
   - tWS, tMain, tPost, HDF 피라미드, tCore, tHalo, tDzA: RGBA16F (LINEAR)
   - 가이드 필터 중간(p,p²)·박스 결과: RG32F (texelFetch 전용, NEAREST)
   - tToneAB, tClarAB: RG16F (LINEAR)
   - tRatio, tMin, tTrans, tBlurL 중간·결과: R16F
   - uToneInv 4096×1, uCurve 256×1: R16F LINEAR
   - 3D LUT: RGB16F ← Float32 업로드, NEAREST(texelFetch 전용)
7. 정점: 속성 없는 전체 화면 삼각형 drawArrays(TRIANGLES, 0, 3)
8. 셰이더 조립: 섹션 6 의 header + common + lib_ops + 각 패스 본문 순서로 문자열을 연결한다. 컴파일·링크 실패 시 info log 를 포함한 오류 SHADER_COMPILE_FAILED 를 던진다.

## 5. 수식 기준 (GLSL 은 섹션 6 이 정본, 아래는 동일 수식의 서술)
### 5.1 프로파일 → 유니폼
- uProfile: srgb-image 0, rec709 1, hlg 2, slog3 3, slog2 4, flog 5, flog2 6, clog3 7, vlog 8, nlog 9, dlog 10, applelog 11, raw-linear 12
- samsunglog·dlogm 은 소스 변환 LUT(lutStore 의 role "source-transform", sourceProfile 일치)가 있으면 13.
  - 없으면 1(rec709)로 표시하고 경고 SOURCE_TRANSFORM_LUT_REQUIRED.
  - 소스 LUT 입력은 브라우저가 Full 로 확장한 신호 v 이다. LUT 파일의 LUT_IN/OUT_VIDEO_RANGE 플래그만 적용한다(uSrcLutInVR/OutVR).
- pq: 오류 PQ_UNSUPPORTED
- uLimitedCV = (profile ∈ 3~9) && range = "limited"
- uSrcToWS = Step 2 primaries.mjs 의 matrixToWS(primaries). 13 이면 단위행렬.
- uRawScale = descriptor.rawScale ?? 1
- uRgc = primaries ≠ "srgb"
- uRolloff = profile ∈ 2~11
- uSamsungFix = Step 2 descriptor.profile === "samsunglog" (소스 LUT 유무와 무관)
- 디코드 식: COLOR_SCIENCE §4.1~§4.10 (섹션 6 fs_normalize decodeLog)
- SDR: srgb-image d = srgbDec(v) → s = d^(1/2.4). rec709 는 s = v. 그다음 Tref⁻¹ 표.
### 5.2 Samsung Log 피부 마젠타 보정 (Step 2 인계 1번, S0 에서 행렬 형식으로 적용)
- OKLab(WS) → C = |ab|, h = atan2(b,a)°
- w = exp(−0.5·(wrap180(h−50)/16)²)·sstep(0.02,0.06,C)·(1−sstep(0.85,1,L))
- [a',b'] = (1−0.04w)·[[cos4w°, −sin4w°],[sin4w°, cos4w°]]·[a,b]
- 전역 3×3 행렬은 피부 외 색까지 이동시키므로 쓰지 않는다. 4°, 0.04 는 COLOR_SCIENCE §14 보정 대상 기본값이다.
### 5.3 소프트 색역 압축 (ACES 1.3 Reference Gamut Compression 식, WS 에 적용, uRgc 일 때)
- ach = max(r,g,b). ach ≤ 0 이면 그대로.
- d_c = (ach − c)/ach
- 채널별 (lim, thr) = R(1.147, 0.815), G(1.264, 0.803), B(1.312, 0.880), pwr = 1.2
- d < thr 면 그대로. 아니면
  scl = (lim−thr)/((((1−thr)/(lim−thr))^(−pwr) − 1)^(1/pwr))
  nd = (d−thr)/scl
  d' = thr + scl·nd/(1+nd^pwr)^(1/pwr)
- c' = ach − d'·ach
### 5.4 필름 하이라이트 롤오프 (uRolloff 일 때)
- Y = luma709(max(x,0)). Y ≤ 1 이면 그대로.
- Y' = 1 + 1.04·tanh((Y−1)/1.04), x' = x·Y'/Y
- 백색 2.04 = T_ref hdrMax 에 점근한다.
### 5.5 화이트밸런스·노출 (CPU 에서 행렬 계산)
- uWB = COLOR_SCIENCE §8.1 (Kang 2002 흑체 궤적, CIE1960 uv, 틴트 법선, Bradford) 를 709 행렬로 감싼 것
- uExpGain = 2^EV, EV ∈ [−5, 5]
### 5.6 HDF 이중 반경 광학 확산 (S1)
- 발광원 s = max(x,0)·sstep(0.60, 2.00, Y), Y = luma709(max(x,0)). 하이라이트만 산란하므로 암부 블랙과 중간톤 선예도가 유지된다.
- 합성: x' = x − 0.48·s + 0.30·core + 0.18·halo
  - core(Core Halation): σc = 0.0035·D
  - halo(Wide Veil): σh = 0.022·D
  - D = 렌더 대상 전체 이미지 대각선(px)
- 블러: 반해상도 발광원 추출(L1) → 2×2 박스 다운샘플 피라미드
  - 반경별 레벨 n = max(1, floor(log2(σ/2))), σn = max(σ/2ⁿ, 0.5), 반경 r = min(12, ceil(3σn))
  - 그 레벨에서 가로·세로 분리 가우시안 w_i = exp(−i²/(2σn²)) 정규화
  - 합성은 쌍선형 업샘플(texture)
### 5.7 디헤이즈 (S2)
- A: D 해상도의 HDF 합성 후 WS 를 읽어온다(섹션 8.4)
  1. 어두운 채널 = min(r,g,b)
  2. 7×7 최소 필터(가장자리 clamp)
  3. 값 상위 max(1, floor(0.001·N)) 픽셀의 rgb 평균
  4. 채널별 max(A, 0.05)
- 전달률: m = min_c(x_c/A_c) → 7탭 최소 가로·세로 → t̃ = 1 − 0.95·m → 자기 가이드 필터(r_dz, ε = 0.001) → t = clamp(mean_a·t̃ + mean_b, 0, 1)
- 적용
  D > 0: k = D/100, te = mix(1, max(t,0.1), k), J = (x−A)/te + A
  D < 0: k = −D/100, J = mix(x, A, 0.4k)
  x' = max(J, 0)
### 5.8 베이스 레이어 톤 S3, 대비 S4
- COLOR_SCIENCE §8.4, §8.5 그대로
- 가이드 베이스: 분석 해상도 A 에서 p = log2(max(luma709(x), 2⁻²⁰)), 자기 가이드 필터(r_t, ε = 0.25) → (mean_a, mean_b) 를 쌍선형 업샘플 → Bs = mean_a·Yl + mean_b
- 마스크: m_sh = exp(−0.5((e+3)/1.5)²), m_hi = sstep(−0.5,2.5,e), m_wh = sstep(1.5,3.8,e), m_bk = 1−sstep(−7,−3,e), m_mid = exp(−0.5(e/1.8)²)
- ΔB = 1.5·S_sh·m_sh + 1.5·S_hi·m_hi + 1.0·S_wh·m_wh + 1.0·S_bk·m_bk + 1.0·S_br·m_mid + 1.2·S_lb·(m_sh − m_hi)
- x' = x·2^(Bs+ΔB+Dt)/Y
- 라이트 밸런스 S_lb 가 암부 복원(+m_sh)과 명부 억제(−m_hi)를 한 슬라이더로 묶는다.
- 대비: Y' = 0.18·2^(e·(1+0.5·S_ct))
### 5.9 광학 비네팅 cos⁴θ (S5, 장면 선형)
- α = W/H, p = (uv−0.5)·(α,1), r = |p|/|(α,1)·0.5| (모서리 = 1)
- k = |Vg|/100, tanθ = r·k
- f = cos⁴θ = 1/(1 + (r·k)²)²
- Vg < 0 이면 x' = x·f, Vg > 0 이면 x' = x/f
### 5.10 S6 음수 제거, S7 LUT
- COLOR_SCIENCE §8.6, §7 그대로
- 내장 LUT: u = FSH-v1 셰이퍼(x) → 33³ 사면체
- 원본: v = srgbEnc(toneRef(x))
### 5.11 S8 컬러 크롬 이펙트·FX 블루 (흑백 시뮬레이션에서는 끈다)
- 수식 정본은 COLOR_SCIENCE §10. 명도 곱셈 압축 + 크로마 증폭 → gamutMap
- uKe, uKb: OPT-v1 농도 계수. uKe 끔 0 / 약 0.075 / 강 0.145, uKb 끔 0 / 약 0.065 / 강 0.13 (COLOR_SCIENCE §10)
### 5.12 S9 톤 커브
- 프리셋 5종, 터치 그래프, 5구간 슬라이더, Fritsch–Carlson: COLOR_SCIENCE §8.7
- 256칸 굽기: T[i] = F(i/255) 후 단조 보정
- 채널별 texture(uCurve, ((v·255+0.5)/256, 0.5))
- uCurveOn = (프리셋이 linear 이고 사용자 점이 없고 5구간이 전부 0) 의 부정
### 5.13 S10 채도·생동감, S11 명료도
- COLOR_SCIENCE §8.8, §8.9
- 생동감 피부 보호: skin(h) = exp(−0.5(wrap180(h−55)/20)²), 양수일 때 g = 1 + (V/100)(1−sstep(0,0.2,C))(1−0.5·skin)
- 명료도 베이스: S8·S9 를 적용한 L 의 자기 가이드 필터(r_c, ε = 0.004)
- L' = L + 1.2(Cl/100)(L−base)·4L(1−L)
### 5.14 S12 선명도 (루미넌스 언샵 마스크)
- L 블러: σ = 1, 반경 3 분리형
- D = L − blur, D' = sign(D)·max(|D|−0.004, 0)
- L' = L + (Sh/100)·1.2·D', Sh ∈ [0,150]
### 5.15 S13 은염 클럼핑 그레인
- 픽셀 격자 삼각 PDF 백색 노이즈(pcg3d) + 소 커널(중심 70%·4방향 30%) / 대 3×3 클러스터 55% 중첩, n 정의는 COLOR_SCIENCE §16.13 (저주파 보간 노이즈 폐기)
- 루미넌스 마스크 b(vl) = 0.2 + 0.8·4·vl·(1−vl), vl = luma709(v) (중간톤 최대, 바닥값 0.2)
- v' = clamp(v + 0.06·(A/100)·b·n)  (n 표준편차 1, §16.13)
- 셀 c = floor(이미지 픽셀 중심 좌표/scale + off)
### 5.16 S14 디더
- pcg3d 해시
- v8 = round(clamp(v + (n1+n2−1)/255)·255), n1 = pcg3d(x,y,0).x/2³², n2 = pcg3d(x,y,1).x/2³²

## 6. GLSL 소스 (정본 파일 경로)
섹션 4.2-8 조립 규칙(header + common + lib_ops + 패스 본문)은 src/lib/render/glsl/index.ts 의 assembleFragment 가 구현한다.
- header.glsl → src/lib/render/glsl/header.ts (HEADER_GLSL)
- common.glsl → src/lib/render/glsl/common.ts (COMMON_GLSL)
- lib_ops.glsl → src/lib/render/glsl/lib_ops.ts (LIB_OPS_GLSL)
- vs.glsl (정점, 단독) → src/lib/render/glsl/vs.ts (VS_GLSL)
- fs_normalize.glsl → src/lib/render/glsl/fs_normalize.ts (FS_NORMALIZE_GLSL)
- fs_hdf_extract.glsl → src/lib/render/glsl/fs_small.ts (FS_HDF_EXTRACT_GLSL)
- fs_down2.glsl → src/lib/render/glsl/fs_small.ts (FS_DOWN2_GLSL)
- fs_gauss.glsl → src/lib/render/glsl/fs_small.ts (FS_GAUSS_GLSL)
- fs_box.glsl → src/lib/render/glsl/fs_small.ts (FS_BOX_GLSL)
- fs_gf_ab.glsl → src/lib/render/glsl/fs_small.ts (FS_GF_AB_GLSL)
- fs_min7.glsl → src/lib/render/glsl/fs_small.ts (FS_MIN7_GLSL)
- fs_prep.glsl → src/lib/render/glsl/fs_small.ts (FS_PREP_GLSL)
- fs_dz_tt.glsl → src/lib/render/glsl/fs_small.ts (FS_DZ_TT_GLSL)
- fs_dz_q.glsl → src/lib/render/glsl/fs_small.ts (FS_DZ_Q_GLSL)
- fs_main.glsl → src/lib/render/glsl/fs_main.ts (FS_MAIN_GLSL)
- fs_post.glsl → src/lib/render/glsl/fs_post.ts (FS_POST_GLSL)
- fs_blurL.glsl → src/lib/render/glsl/fs_small.ts (FS_BLURL_GLSL)
- fs_final.glsl → src/lib/render/glsl/fs_final.ts (FS_FINAL_GLSL)
- fs_probe.glsl → src/lib/render/glsl/fs_small.ts (FS_PROBE_GLSL)

## 7. 렌더 그래프 (src/lib/render/graph.ts)
### 7.1 크기
- 렌더 크기 R
  - 사진 미리보기: 프록시 크기(장축 ≤ 2048)
  - 비디오: 섹션 10.5
  - 타일: 섹션 12
- 분석 크기 A: 장축 A_long = min(R_long, 사진 1024 / 비디오 256). 각 축 = max(1, round(R·A_long/R_long))
- 디헤이즈 크기 D: 장축 D_long = min(R_long, 사진 512 / 비디오 256), 같은 방식
- 가이드 반경: r_t = max(1, round(20·A_long/1024)), r_c = max(1, round(30·A_long/1024)), r_dz = max(1, round(16·D_long/512))
- 분석·디헤이즈 패스는 uTileOrigin = (0,0), uImageSize = uDstSize 로 그린다.
### 7.2 패스 순서와 생략 규칙 (실효 파라미터 기준)
1. normalize → tWS (R)
2. HDF (uHdf 일 때만)
   - fs_hdf_extract → L1(ceil(R/2))
   - fs_down2 반복 → L2…L_max, max = max(nc, nh)
   - 레벨 nc 에서 fs_gauss 가로·세로 → tCore, 레벨 nh 에서 → tHalo
3. 디헤이즈 (D ≠ 0 일 때만)
   - prep mode1 → tDzA(D), A 갱신(섹션 8.4)
   - prep mode2 → tRatio
   - fs_min7 가로·세로 → tMin
   - fs_dz_tt → RG32F → fs_box 가로·세로 → fs_gf_ab(ε 0.001) → fs_box 가로·세로 → fs_dz_q → tTrans(R16F)
4. 베이스 톤 (S_sh,S_hi,S_wh,S_bk,S_br,S_lb 중 하나라도 ≠ 0)
   - prep mode0(A) → box 가로·세로(r_t) → gf_ab(ε 0.25) → box 가로·세로 → tToneAB(RG16F)
   - uToneOps = true
5. main → tMain (R)
6. 명료도 (Cl ≠ 0): prep mode3(A, uSrcPx = R) → box(r_c) → gf_ab(ε 0.004) → box → tClarAB
7. post → tPost (R)
8. 선명도 (Sh > 0): fs_blurL 가로(uChan 3) → R16F, 세로(uChan 0) → tBlurL
9. final
   - 캔버스: uFlipY true, uDither true
   - 타일: RGBA8 FBO, uFlipY false, uDither true
   - 프로브: RGBA16F FBO, uDither false
- 생략된 단계의 샘플러 유니폼에는 1×1 더미 텍스처(값 0)를 바인딩한다.
- 렌더 타깃은 (크기, 형식) 키 풀에서 재사용하고, 소스나 R 이 바뀌면 해제한다.

## 8. CPU 측 계산 (src/lib/render/*)
1. tone-inv-table.ts
   - table[i] = toneInv((i/4095)^2.4), i=0~4095 (Step 1 engine.mjs toneInv, 48회 이분법)
   - Float32 → R16F 4096×1. 앱 수명 동안 1회 생성.
2. curve.ts: COLOR_SCIENCE §8.7 프리셋·Fritsch–Carlson·5구간·단조 보정 → 256칸 Float32 → R16F 256×1
3. wb.ts
   - COLOR_SCIENCE §8.1 로 M_wb 를 계산한다.
   - M_709→XYZ 는 RP177 유도 [[0.412391,0.357584,0.180481],[0.212639,0.715169,0.072192],[0.019331,0.119195,0.950532]], 역행렬은 여인수 공식.
   - colMajor(M) 헬퍼
4. 디헤이즈 A (dehaze-atm.ts)
   - 사진: tDzA 를 readPixels(RGBA, FLOAT) 동기 판독 → 섹션 5.7 의 A 계산.
     A 는 (소스, WB, 노출, HDF) 서명이 바뀔 때만 다시 계산한다(디헤이즈 슬라이더 변경 시 재계산 없음).
   - 비디오: 섹션 10.6
5. 그레인 유니폼
   - outShort = 출력 이미지 짧은 변(사진 displaySize, 비디오 표시 크기, 타일 = 내보내기 출력 크기)
   - scale = max(1, outShort/1080), uGrainCoarse = Sz/100 (COLOR_SCIENCE §11)
   - 미리보기 f = outShort/R_short, uGrainScale = max(1, scale/f). 타일은 uGrainScale = scale.
   - seed: 사진 0, 비디오 round(mediaTime·fps)
   - uGrainOff = (frac(seed·0.754877666)·1000, frac(seed·0.569840291)·1000) (CPU double 로 계산)
6. HDF 유니폼
   - σ = 0.0035·D (core), 0.022·D (halo), D = sqrt(W²+H²)
   - W,H = 미리보기는 R, 타일은 출력 전체 이미지 크기
   - 레벨·반경은 섹션 5.6 식
7. uWsToSG3C = (Step 2 의 S-Gamut3.Cine→709 행렬)의 역행렬

## 9. 원터치 마스터 레시피 (src/lib/render/recipes.ts) — FSE-v2 로 대체됨
> **FSE-v2 로 대체됨**: 숨은 레시피 레이어·중립 RECIPES 표·shaderHints 는 삭제되었다. 필름별 빛·톤·질감은 src/lib/render/film-presets.ts 프리셋이 슬라이더 값으로 담당하고(COLOR_SCIENCE §20), 렌더러에는 카메라 ISP 6단계(COLOR_SCIENCE §19, 패스 `mh_extract` 추가로 프래그먼트 17개)가 더해졌다. 아래는 기록용이다.
### 9.1 원칙
- 실기 SOOC 의 공장 기본 설정을 표로 고정한다: 그레인 끔, 컬러 크롬 끔, FX 블루 끔, 하이라이트/섀도 톤 0, 샤프니스 0 의 JPEG 엔진 기본 선명화.
- 톤과 색 성격은 FSE-v2 LUT 가 전담한다. 레시피는 모든 시뮬레이션에서 중립(0/끔)이다(COLOR_SCIENCE §15, 이중 적용 금지).
- 시뮬레이션을 고르는 순간 레시피가 숨은 레이어로 적용되고 사용자 슬라이더는 0 을 유지한다.
- manifest 의 shaderHints 는 이 표에 이미 포함되어 있으므로 렌더러는 shaderHints 를 읽지 않는다(이중 적용 금지).
### 9.2 표 (필드 순서: sharpen, clarity, highlights, shadows, vignette, grain, cce, fxb, hdf)
- none(원본): 0, 0, 0, 0, 0, {0,0}, 0, 0, false
- fuji-provia, fuji-velvia, fuji-astia, fuji-classic-chrome, fuji-reala-ace, fuji-pro-neg-hi, fuji-pro-neg-std, fuji-classic-neg, fuji-nostalgic-neg, fuji-eterna, fuji-eterna-bleach-bypass: 35, 0, 0, 0, 0, {0,0}, 0, 0, false
- fuji-acros, fuji-acros-ye, fuji-acros-r, fuji-acros-g: 45, 0, 0, 0, 0, "acros-iso", 0, 0, false
- fuji-monochrome, fuji-monochrome-ye, fuji-monochrome-r, fuji-monochrome-g, fuji-sepia: 35, 0, 0, 0, 0, {0,0}, 0, 0, false
- ricoh-standard, ricoh-vivid, ricoh-positive-film, ricoh-negative-film, ricoh-bleach-bypass, ricoh-cross-process: 50, 0, 0, 0, 0, {0,0}, 0, 0, false
- ricoh-retro: 50, 0, 0, 0, −25, {0,0}, 0, 0, false
- ricoh-hdr-tone: 50, 70, −50, 40, 0, {0,0}, 0, 0, false
- ricoh-monotone: 50, 0, 0, 0, 0, {0,0}, 0, 0, false
- ricoh-soft-monotone: 40, 0, 0, 0, 0, {0,0}, 0, 0, false
- ricoh-hard-monotone: 55, 0, 0, 0, 0, {0,0}, 0, 0, false
- ricoh-hi-contrast-bw: 55, 0, 0, 0, −45, {55,45}, 0, 0, false
- "acros-iso" 규칙: ISO = EXIF 0x8827(없으면 200), amount = clamp(round(8·log2(ISO/160)), 0, 45), size = ISO ≥ 3200 ? 60 : 25
- 테스트: 표의 id 집합 = manifest sims id 32개 + "none"
### 9.3 실효값 (params.ts)
- 사용자 슬라이더 범위
  노출 [−5,5] 단계 0.01
  라이트 밸런스·밝기·대비·하이라이트·쉐도우·흰색·검정·색온도·틴트·채도·생동감·명료도·디헤이즈·비네팅 [−100,100] 단계 1
  선명도 [0,150]
  그레인 강도 [0,100], 크기 [0,100]
  모두 기본 0, 더블탭(300ms 이내 두 번 탭 또는 dblclick) = 0
- 실효 수치 = clamp(사용자 + 레시피, 범위). 대상: sharpen, clarity, highlights, shadows, vignette, grainAmount
- grainSize 실효 = 사용자 크기 > 0 ? 사용자 : 레시피 크기
- cce, fxb, hdf: 사용자 값이 "recipe" 이면 레시피 값, 아니면 사용자 값. 흑백 시뮬레이션은 cce·fxb UI 를 숨기고 0 으로 고정한다.
- 셰이더 전달
  uSh = shadows/100, uHi = highlights/100, uWh = whites/100, uBk = blacks/100, uBr = brightness/100, uLb = lightBalance/100, uCt = contrast/100
  uVig = vignette, uSat, uVib, uClarity, uSharpen, uGrainAmt, uDehaze 는 원값
- 자동 보정(auto.ts): COLOR_SCIENCE §12 로 사용자 값을 기록한다. WS 는 Step 2 normalize.mjs 의 toWorkingSpace 사용. 비디오는 첫 프레임 프록시로 계산.

## 10. 비디오
### 10.1 회전 메타 (Step 2 인계 2번) — video-probe.ts 추가 구현
- 비디오 트랙(hdlr "vide")의 tkhd 행렬 a, b, c, d (i32, 16.16)를 읽는다.
  - 박스 시작 기준 v0: 행렬 48~84, 폭 84~88, 높이 88~92
  - 박스 시작 기준 v1: 행렬 60~96, 폭 96~100, 높이 100~104
- s = sqrt(a²+b²), (A,B,C,D) = 각 값/s 를 반올림해 {−1,0,1} 로 만든다.
- EXIF 동등 방향 매핑 (QuickTime x' = a·x + c·y, y' = b·x + d·y)
  (1,0,0,1)→1, (−1,0,0,1)→2, (−1,0,0,−1)→3, (1,0,0,−1)→4, (0,1,1,0)→5, (0,1,−1,0)→6, (0,−1,1,0)→8, (0,−1,−1,0)→7
  그 외는 1 + 경고 ROTATION_UNSUPPORTED
- types.ts VideoInfo 에 rotation: { matrix: [a,b,c,d]; orientation: number; codedWidth: number; codedHeight: number } 를 추가한다.
- 표시 크기 = orientation ∈ 5~8 ? (codedHeight, codedWidth) : (codedWidth, codedHeight). video.videoWidth 는 신뢰하지 않는다.
### 10.2 브라우저 업로드 방향 판별 (video-orientation-probe.ts, 회전 영상 첫 로드 시 1회, 결과 캐시)
1. 아래 Base64 를 디코드해 sha256 = 999e9f931b1d46cef419d298602884212189552190485291d8e58b92f2a129dc 를 확인한다.
   이 영상은 32×16 H.264, 왼쪽 절반 빨강·오른쪽 절반 파랑, tkhd 행렬 (0,1,−1,0) = 90° 시계방향(아이폰 세로 촬영과 동일)이다.
   (원문 Base64 는 손상되어 있어 사용자 승인으로 재생성본으로 교체했다 — 구현 노트 1. 현재 정본: src/lib/render/probe-mp4.ts, sha256 c052086b7f865ed213963fb799305459608d0f98d17bed86fd25009bd5273f32)
2. <video muted playsInline preload="auto"> + Blob URL. loadeddata 를 최대 4000ms 대기한다. 초과하면 결과 "unknown".
3. dimsRotated = (videoWidth, videoHeight) === (16, 32)
4. 임시 RGBA8 텍스처에 texImage2D(video) 로 올린다(섹션 4.2 업로드 규칙). fs_probe 로 64×64 RGBA8 FBO 에 그린 뒤 readPixels 한다. 행 0 = 이미지 윗줄.
5. 표본 (u,v) → 픽셀 (floor(64u), floor(64v)): A(0.25,0.5), B(0.75,0.5), C(0.5,0.25), D(0.5,0.75)
   - isRed: R > 160 && B < 96, isBlue: B > 160 && R < 96
   - isRed(A) && isBlue(B) → textureRotated = false
   - 그렇지 않고 isRed(C) && isBlue(D) → textureRotated = true
   - 그 외 → textureRotated = dimsRotated (폴백), 경고 ORIENTATION_PROBE_UNKNOWN
6. 결과로 정한다
   - 잔여 방향 uOrient = textureRotated ? 1 : rotation.orientation
   - 저장 크기 uSrcSize = textureRotated ? 표시 크기 : coded 크기
   - 캔버스 종횡비는 항상 표시 크기. 영상이 눕거나 찌그러지지 않는다.
### 10.3 텍스처 업로드
- 매 프레임 texImage2D(TEXTURE_2D, 0, fmt, RGBA, type, video)
- 첫 업로드에서 (RGBA16F, HALF_FLOAT) 를 시도한다. getError() ≠ NO_ERROR 면 (RGBA8, UNSIGNED_BYTE) 로 고정한다. 결과는 caps.videoHalfFloatUpload 에 기록.
- descriptor 는 Step 2 감지 결과와 배지 전환 값을 쓴다(range 반영, 섹션 5.1).
### 10.4 재생 루프 (video-source.ts)
- 재생·일시정지는 사용자 탭으로만 한다. 재생 시 muted=false 로 오디오를 낸다. 오디오와 영상은 <video> 가 동기화하고, 렌더러는 표시 프레임만 따라간다(프레임 재타이밍 금지).
- requestVideoFrameCallback 이 있으면 (now, meta) 마다 업로드 + 전체 그래프를 렌더한다.
  없으면 requestAnimationFrame 에서 video.currentTime 이 바뀐 경우에만 렌더한다.
- seeked, pause 이벤트 때 현재 프레임을 1회 렌더한다.
- frameIndex = round(meta.mediaTime·fps) (그레인 seed)
### 10.5 해상도 단계 (4K60 대응)
- R_long = round(min(1920, 캔버스 CSS 장축·devicePixelRatio)·tier), tier ∈ {1.0, 0.75, 0.5}, 시작 1.0
- 최근 60 표시 프레임 동안 video.getVideoPlaybackQuality().droppedVideoFrames 증가가 > 2 이면 한 단계 낮춘다.
- 300 프레임 연속 증가 0 이고 tier < 1 이면 한 단계 높인다.
- 4K 원본은 디코드만 4K 로 하고, 렌더는 R 에서 한다(S0 의 4탭 영역 표본).
- Step 2 playback4k60 이 supported=false 이면 배너 "이 기기는 4K60 실시간 디코드를 보장하지 않습니다"
### 10.6 비디오 디헤이즈 A
- D ≠ 0 일 때 첫 프레임, 이후 120 표시 프레임마다, WB/노출/HDF 변경 시 갱신한다.
- 갱신 방법: prep mode1 → PIXEL_PACK_BUFFER 로 readPixels(RGBA, FLOAT) → fenceSync. 매 프레임 getSyncParameter(SYNC_STATUS) 가 SIGNALED 면 getBufferSubData → 섹션 5.7 A 계산.
- 첫 A 전에는 A = (0.9, 0.9, 0.9)

## 11. 사진 렌더
- setPhotoSource(asset): asset.proxy(Float32 RGBA, 표시 방향 적용됨)를 uSrc 로 업로드한다. uOrient = 1, R = 프록시 크기.
- 파라미터가 바뀌면 requestAnimationFrame 1회로 합쳐 전체 그래프를 렌더한다. 슬라이더를 연속으로 끌 때도 같은 방식이다.

## 12. 원본 해상도 타일 렌더 (Step 4 저장용 API, 이번 단계에서 구현·검증)
- renderTile({ rect, outScale }) → Promise<Uint8ClampedArray> (RGBA, rect 크기)
  - rect: 출력 이미지 좌표
  - outScale: 1 = 원본, <1 = 압축 저장
- 전제: 같은 파라미터로 미리보기 렌더가 끝나 tHalo, tTrans, tToneAB, tClarAB, A 가 최신이어야 한다(chainVersion 비교, 불일치 시 예외 STALE_PREVIEW_CHAIN).
- 패딩 P = ceil(3·σc_out) + 8 (출력 px), σc_out = 0.0035·(출력 전체 이미지 대각선)
- 소스 영역 = (rect ± P)/outScale 를 이미지 범위로 clamp. Step 2 getFullResolutionTile 로 받는다.
- normalize(R = 패딩 포함 출력 크기, 다운스케일이면 4탭)
- HDF core 는 타일 안에서 계산(로컬 uv), halo 는 미리보기 텍스처(전역 uv)
- 디헤이즈·베이스 톤·명료도 계수는 미리보기 텍스처(전역 uv)
- 유니폼: uTileOrigin = 패딩 포함 원점, uImageSize = 출력 전체 크기
- final: uCropOrigin = 실제 패딩, uImgPxOrigin = rect 원점, uDither = true → RGBA8 FBO readPixels
- 타일 최대 1024×1024(+패딩)

## 13. 렌더러 API (src/lib/render/renderer.ts)
```ts
export interface RendererCaps { floatRender: "full" | "half"; rg32fRenderable: boolean; videoHalfFloatUpload: boolean | null; maxTextureSize: number; max3DTextureSize: number; }
export interface RenderStats { passes: number; cpuMs: number; R: { width: number; height: number }; }
export class FilmRenderer {
  static create(canvas: HTMLCanvasElement): FilmRenderer;
  readonly caps: RendererCaps;
  setPhotoSource(asset: MediaAsset): void;
  setVideoSource(asset: MediaAsset, file: File): Promise<void>;
  setParams(p: RenderParams): void;
  renderNow(): RenderStats;
  renderTile(req: { rect: { x: number; y: number; width: number; height: number }; outScale: number }): Promise<Uint8ClampedArray>;
  probe(points: Array<[number, number]>): Float32Array;
  readonly video: { play(): Promise<void>; pause(): void; seek(t: number): void; stats(): { presentedFps: number; dropped: number; tier: number } };
  dispose(): void;
}
```
- 내장 LUT: manifest 의 bin 을 "?v=" + sha256Bin 앞 12자 로 fetch → Step 1 decodeBinLut → RGB16F 3D. 최근 4개 LRU 캐시.
- 외부 Look LUT: Step 1 lutStore(role "look") 를 uLutMode 2 로 쓰고, 도메인과 플래그를 유니폼으로 전달한다.
- 컨텍스트 손실(webglcontextlost) 시 모든 리소스를 재생성하고 마지막 상태로 다시 렌더한다.

## 14. 검증 화면 /lab/renderer (src/app/lab/renderer/page.tsx, "use client", 모바일 퍼스트, 터치 ≥ 44px)
1. 상단
   - 파일 선택(Step 2 loadMedia)
   - 캡 정보: caps, 방향 판별 결과
   - Log 배지(Step 2 감지 + 전환 칩)와 소스 LUT 선택
2. 캔버스: 표시 크기 종횡비 유지, 폭 100%
3. 브랜드 탭 [FUJIFILM 20] [RICOH GR 12] 과 "원본" 칩
   - 시뮬레이션 칩을 가로 스크롤로 나열한다. 탭 1번으로 LUT 와 레시피가 적용된다.
   - 적용 중인 레시피 값을 작은 글씨로 표시한다.
4. 효과 줄
   - FUJIFILM 탭: 컬러 크롬 이펙트(끔/약/강), 컬러 크롬 FX 블루(끔/약/강). 흑백 시뮬레이션에서는 숨긴다.
   - RICOH 탭: [HDF ON/OFF]
   - 공통: 그레인 강도·크기
5. 보정
   - "자동" 버튼
   - 슬라이더 순서: 노출, 라이트 밸런스, 밝기, 대비, 하이라이트, 쉐도우, 흰색, 검정, 색온도, 틴트, 채도, 생동감, 명료도, 선명도, 디헤이즈, 비네팅
   - 값 표시, 더블탭으로 0
6. 톤 커브
   - 프리셋 칩: 선형, 약한 대비, 강한 대비, 매트, 소프트 하이라이트
   - 256×256 그래프: 빈 곳 탭 = 점 추가(최대 12), 드래그 = 이동, 길게 누르기 500ms = 삭제(끝점 제외), 더블탭 = 선형
   - 5구간 슬라이더: 블랙, 섀도, 미드톤, 라이트, 하이라이트
7. 비디오: 재생/일시정지, 탐색 막대, 시간, 표시 fps, 드롭 프레임, tier
8. 검증 버튼
   a. "GPU↔CPU 프로브"
      - 공간 단계(HDF, 디헤이즈, 베이스 톤, 명료도, 선명도)와 그레인을 끈 현재 파라미터로 프로브 렌더(RGBA16F, 디더 끔)
      - 4×4 격자 점((i+0.5)/4, (j+0.5)/4)을 섹션 15.2 CPU 참조와 비교. 최대 차 ≤ 2/255 면 PASS
   b. "그레인 프로브": 그레인 강도 50 으로 같은 비교, 허용 3/255
   c. "타일 이음새 검증": 섹션 12 로 가로로 인접한 두 타일과 두 타일을 덮는 단일 타일을 렌더해 같은 픽셀을 비교. 최대 차 ≤ 1/255 면 PASS
   d. "성능": 사진 renderNow 30회 평균 cpuMs, 비디오 10초 표시 fps

---

## 구현 노트 (원문 아님 — 원문과 다르게 처리한 부분과 해석 기록)
1. **10.2-1 프로브 영상 교체 (사용자 승인).** 원문 Base64 는 디코드 결과 sha256 이 8a2e9dd8…0a04 로 명세값(999e9f93…29dc)과 다르고, mvhd 가 1바이트 짧아 trak 이후 박스 구조가 깨져 있으며, tkhd 행렬도 (0,1,−1,0)이 아닌 단위행렬(32×16)이었다. ffmpeg 6.1.1 로 같은 사양(32×16 H.264 baseline, 왼쪽 빨강·오른쪽 파랑, tkhd (0,1,−1,0))을 bitexact 로 재생성했다. 생성 명령과 Base64 는 src/lib/render/probe-mp4.ts, 새 sha256 은 c052086b7f865ed213963fb799305459608d0f98d17bed86fd25009bd5273f32. 15.2-5 테스트는 이 파일로 sha256·orientation 6·coded 32×16·표시 16×32 를 단언한다.
2. **15.2-6 glslang 실행 권한 (사용자 승인).** npm 이 glslang-validator-prebuilt-predownloaded 바이너리를 실행 권한 없이 설치하므로(EACCES), 테스트는 os.tmpdir() 사본에 chmod 755 를 준 뒤 실행한다. 그래도 실행할 수 없을 때만 사유를 출력하고 skip 한다.
3. **12 타일 실제 패딩 정렬.** P = ceil(3·σc_out)+8 은 최소 패딩으로 두고, 패딩 포함 원점·끝을 2^n_core(HDF core 레벨) 배수로 넓힌다(이미지 경계에서는 clamp). 타일마다 L1=ceil(R/2) 피라미드를 새로 만들고 core 를 로컬 uv 로 샘플하므로, 원점·크기가 레벨 격자에 맞지 않으면 타일 간 core 위치가 최대 2^(n−1) px 어긋나 이음새가 생긴다(실측: HDF ON 시 3~20/255 → 정렬 후 0/255). uCropOrigin 은 이 "실제 패딩"을 쓴다.
4. **10.2-5 폴백 확장.** 프로브 영상 자체를 디코드하지 못해(코덱 미지원 등) dimsRotated 를 얻지 못하면, 같은 크기 비교를 실제 영상에 적용한다: videoWidth×videoHeight 가 coded 크기의 가로세로 교환이면 textureRotated = true. 경고 ORIENTATION_PROBE_UNKNOWN 은 그대로 남긴다. (video.videoWidth 는 표시 크기 계산에는 쓰지 않는다.)
5. **probe(points) 확장 인자.** 14-8a/b 의 "공간 단계와 그레인을 끈" 프로브는 레시피가 더한 실효값(예: 선명도 35)까지 꺼야 하므로 probe(points, { grainAmount }) 두 번째 인자(기본 0)로 실효값을 덮어쓴다. CPU 참조는 referenceContext() 가 같은 실효값으로 만든다.
6. **비디오 요소.** iOS Safari 의 프레임 콜백·오디오 안정성을 위해 <video> 를 보이지 않는 1px 요소로 문서에 붙인다.
7. **자동 보정 프록시.** COLOR_SCIENCE §12 의 "긴 변 256px 프록시"는 Step 2 proxy(≤2048)에서 각 출력 칸의 중심 텍셀을 표본으로 뽑아 만든다(표본 후 toWorkingSpaceBuffer). WB 후보 판정은 EV 적용 후 값을 쓴다.

# COLOR_SCIENCE.md — Film Lab 컬러 사이언스 명세 (FSE-v2)

> **FSE-v2 카메라 렌더링 업그레이드**: 필름 3D LUT 는 색 전용 커널(§18)로, 필름별 톤·질감은 프리셋 슬라이더(§20)로, 빛 구조는 카메라 ISP 6단계(§19)로 나눈다. 역할 분담 계약은 §17.
> 아래 §6(이전 필름 엔진 renderPoint)·§6.1a·§14 의 톤 파라미터 범위·§15(중립 레시피)는 **FSE-v2 로 대체됨** 이며 기록용으로만 남긴다.

## §1 표기
- 각도는 도(°). cos/sin/atan2 호출 시 DEG = π/180 으로 변환한다.
- clamp(x,a,b) = min(b, max(a, x))
- smoothstep(e0,e1,x) = t·t·(3 − 2t), t = clamp((x − e0)/(e1 − e0), 0, 1)
- mix(a,b,t) = a + (b − a)·t
- wrap180(t) = ((t % 360) + 540) % 360 − 180  (% 는 JS 나머지 연산과 동일한 의미)
- luma709(rgb) = 0.2126·R + 0.7152·G + 0.0722·B (선형값 전용)
- 생성기(Node)는 float64, GPU 는 float32 연산 + RGBA16F 저장.

## §2 작업 색공간 WS 와 표시 인코딩
- WS: 장면 선형(scene-referred linear), 원색 Rec.709/sRGB, 백색 D65(0.3127, 0.3290). 0.18 = 18% 그레이. 음수와 1 초과를 허용한다.
- srgbEnc(y) = y ≤ 0.0031308 ? 12.92·y : 1.055·y^(1/2.4) − 0.055
- srgbDec(v) = v ≤ 0.04045 ? v/12.92 : ((v + 0.055)/1.055)^2.4

## §3 RGB↔XYZ 행렬 (SMPTE RP 177 유도)
- 원색 (x_i, y_i) 마다 X_i = x_i/y_i, Y_i = 1, Z_i = (1 − x_i − y_i)/y_i 로 P = [[Xr Xg Xb],[Yr Yg Yb],[Zr Zg Zb]] 을 만든다.
- 백색 W = [x_w/y_w, 1, (1 − x_w − y_w)/y_w]ᵀ, S = P⁻¹·W, M_RGB→XYZ = P·diag(S).
- M_src→WS = (M_709→XYZ)⁻¹ · M_src→XYZ. 표의 백색이 모두 D65 이므로 색순응 변환은 넣지 않는다.
- 검증값: sRGB 의 M_RGB→XYZ = [[0.4124,0.3576,0.1805],[0.2126,0.7152,0.0722],[0.0193,0.1192,0.9505]] (±1e-4)
- 원색표 (xy, 백색 전부 D65)
  Rec.709/sRGB: R(0.640,0.330) G(0.300,0.600) B(0.150,0.060)
  Display P3: R(0.680,0.320) G(0.265,0.690) B(0.150,0.060)
  Adobe RGB (1998): R(0.640,0.330) G(0.210,0.710) B(0.150,0.060), 전달함수 순수 감마 563/256 (= 2.19921875)
  Rec.2020 (Apple Log, F-Gamut, N-Log, HLG, Samsung Log 컨테이너): R(0.708,0.292) G(0.170,0.797) B(0.131,0.046)
  S-Gamut3.Cine: R(0.766,0.275) G(0.225,0.800) B(0.089,−0.087)
  S-Gamut3 / S-Gamut: R(0.730,0.280) G(0.140,0.855) B(0.100,−0.050)
  Canon Cinema Gamut: R(0.740,0.270) G(0.170,1.140) B(0.080,−0.100)
  Panasonic V-Gamut: R(0.730,0.280) G(0.165,0.840) B(0.100,−0.030)
  DJI D-Gamut: R(0.710,0.310) G(0.210,0.880) B(0.090,−0.080)
  F-Gamut C: R(0.7347,0.2653) G(0.0263,0.9737) B(0.1173,−0.0224)

### §3.1 M_src→709 골든 표 (±1e-6)
- display-p3 [[1.224940,-0.224940,0],[-0.042057,1.042057,0],[-0.019638,-0.078636,1.098274]]
- adobe-rgb [[1.398356,-0.398356,0],[0,1,0],[0,-0.042929,1.042929]]
- rec2020 [[1.660491,-0.587641,-0.072850],[-0.124550,1.132900,-0.008349],[-0.018151,-0.100579,1.118730]]
- s-gamut3-cine [[1.626947,-0.540139,-0.086809],[-0.178516,1.417941,-0.239425],[-0.044436,-0.195920,1.240356]]
- s-gamut3 [[1.877915,-0.794169,-0.083746],[-0.176807,1.351000,-0.174193],[-0.026201,-0.148422,1.174623]]
- cinema-gamut [[1.923861,-0.798761,-0.125101],[-0.204311,1.495899,-0.291588],[-0.023685,-0.420127,1.443812]]
- v-gamut [[1.806576,-0.695697,-0.110879],[-0.170090,1.305955,-0.135865],[-0.025206,-0.154468,1.179674]]
- d-gamut [[1.674723,-0.579789,-0.094934],[-0.098088,1.333984,-0.235896],[-0.040967,-0.242984,1.283951]]
- f-gamut-c [[2.119851,-1.075705,-0.044146],[-0.230336,1.372442,-0.142106],[-0.014227,-0.150225,1.164452]]
- M_709→XYZ = [[0.412391,0.357584,0.180481],[0.212639,0.715169,0.072192],[0.019331,0.119195,0.950532]]

## §4 소스 정규화 (S0) — 코드값 → WS
### §4.0 입력값 y 의 정의
- §4.1~§4.7 의 y 는 "10bit 코드값/1023" 이다. 디코더가 Limited range(64~940) 영상을 Full 로 확장한 R'G'B' 값 v(0~1)를 주면 y = (v·876 + 64)/1023 로 되돌려 넣는다. Full range 로 태깅된 스트림이면 y = v 로 둔다.
- §4.8~§4.11 은 범위 변환 후의 정규화 신호 v 를 그대로 쓴다.
- 결과 x 는 반사율 기준 선형값(0.18 = 18% 그레이)이다. 각 감마 행렬(§3)을 곱해 WS 로 보낸다.

### §4.1 Sony S-Log3
- y ≥ 171.2102946929/1023 이면 x = 10^((1023·y − 420)/261.5)·0.19 − 0.01
- 그 외 x = (1023·y − 95)·0.01125/(171.2102946929 − 95)
- 골든: y=0.410557 → 0.18

### §4.2 Sony S-Log2
- f = (1023·y − 64)/876
- y ≥ 0.0882512925 이면 s = 10^((f − 0.646596)/0.432699) − 0.037584, 그 외 s = (f − 0.030001222851889303)/5
- x = s·0.9·219/155
- 골든: 0.339533 → 0.18

### §4.3 Fujifilm F-Log
- 상수: cut2=0.100537775223865, a=0.555556, b=0.009468, c=0.344676, d=0.790453, e=8.735631, f=0.092864
- y ≥ cut2 이면 x = (10^((y − d)/c) − b)/a, 그 외 x = (y − f)/e
- 골든: 0.459318 → 0.18

### §4.4 Fujifilm F-Log2
- §4.3 과 같은 식, 상수: cut2=0.100686685370811, a=5.555556, b=0.064829, c=0.245281, d=0.384316, e=8.799461, f=0.092864
- 골든: 0.391007 → 0.18

### §4.5 Canon Log 3 (v1.2, Limited range 상수)
- y < 0.097465473 이면 s = −(10^((0.12783901 − y)/0.36726845) − 1)/14.98325
- y ≤ 0.15277891 이면 s = (y − 0.12512219)/1.9754798
- 그 외 s = (10^((y − 0.12240537)/0.36726845) − 1)/14.98325
- x = 0.9·s
- 골든: 0.343389 → 0.18

### §4.6 Panasonic V-Log
- y < 0.181 이면 x = (y − 0.125)/5.6, 그 외 x = 10^((y − 0.598206)/0.241514) − 0.00873
- 골든: 0.423311 → 0.18

### §4.7 Nikon N-Log
- y < 0.4418377321603128 이면 x = (y/(650/1023))³ − 0.0075, 그 외 x = exp((y − 619/1023)/(150/1023))
- 골든: 0.363668 → 0.18

### §4.8 DJI D-Log
- v ≤ 0.14 이면 x = (v − 0.0929)/6.025, 그 외 x = (10^(3.89616·v − 2.27752) − 0.0108)/0.9892
- 골든: 0.398765 → 0.18

### §4.9 Apple Log
- 상수: R0=−0.05641088, Rt=0.01, σ=47.28711236, β=0.00964052, γ=0.08550479, δ=0.69336945, Pt = σ·(Rt − R0)²
- v ≥ Pt 이면 x = 2^((v − δ)/γ) − β
- 0 ≤ v < Pt 이면 x = sqrt(v/σ) + R0
- v < 0 이면 x = R0
- 골든: 0.488272 → 0.18
- 보정 체크: 실기 그레이카드 촬영본에서 v ≈ 0.488 인지 Step 4 에서 확인한다.

### §4.10 HLG (BT.2100)
- 상수: a=0.17883277, b=0.28466892, c=0.55991073
- v ≤ 0.5 이면 E = v²/3, 그 외 E = (exp((v − c)/a) + b)/12
- x = E·(0.18/0.0481333333) (BT.2408: 18% 그레이 = HLG 38% 신호)

### §4.11 SDR 이미지 디코드 규칙과 SDR 표시 기준 소스 정규화 (JPEG/PNG/WEBP/HEIC SDR, Rec.709 비디오)
- 이미지 디코드 규칙 (docs/MEDIA_PIPELINE.md §8)
  - 방향(Orientation)은 브라우저 자동 회전에 맡기지 않는다. 디코드 전에 EXIF 를 제거하고 §10.2 매핑을 직접 적용한다(이중 회전 차단). HEIC 는 irot/imir 가 디코드 단계에서 적용되므로 방향을 추가 적용하지 않는다.
  - 알파 채널은 버리고 A=1 로 둔다.
  - 브라우저 경로: 워커 시작 시 display-p3 캔버스 지원을 1회 탐지한다. 지원하면 캔버스 colorSpace "display-p3"(원색 display-p3), 아니면 "srgb". 브라우저가 내장 ICC(sRGB, P3, Adobe RGB 등)를 캔버스 공간으로 색 관리한다. 8bit 값 v = byte/255.
  - 16bit PNG 는 fast-png 로 원값을 보존한다(v = val/65535). 원색은 임베디드 ICC desc 로 분류(소문자 비교: "p3" → display-p3, "srgb" → srgb, "adobe rgb"/"adobergb" → adobe-rgb, "2020" → rec2020, 그 외 srgb + 경고), 없으면 srgb.
  - 전달함수는 srgb-image (Display P3 도 같은 곡선).
- 정규화 식 (docs/MEDIA_PIPELINE.md §12.3)
  - 이미지(srgb-image): x = Tref⁻¹(srgbDec(y)). Rec.709 비디오(rec709): x = Tref⁻¹(y^2.4) (BT.1886, 블랙 0).
  - 소스 원색 공간에서 채널별로 x_src 를 구한 뒤 M_src→WS 를 곱한다.
  - Tref⁻¹: d ≤ 0 → 0, d ≥ 1 → 2.04. 그 외 [0, 2.04] 구간 이분법 48회(m=(lo+hi)/2; tone(m,T_ref) < d 이면 lo=m 아니면 hi=m), 결과 (lo+hi)/2.
  - GPU 에서는 4096칸 R16F 테이블 table[i] = Tref⁻¹((i/4095)^2.4) 를 만들고 s = max(d,0)^(1/2.4) 좌표로 선형 샘플한다.
  - 골든: Tref⁻¹(srgbDec(0.5)) = 0.201706, Tref⁻¹(1) = 2.04

### §4.12 Samsung Log, DJI D-Log M
- Step 4 부터 두 프로파일 모두 외부 LUT 없이 즉시 변환한다. 내장 변환은 §16.1(Samsung Log, 공식 백서 수식)과 §16.2(D-Log M, D-Log 곡선 + D-Gamut 근사)를 따른다.
- 사용자가 제조사 공식 변환 LUT(.cube, Log → Rec.709)를 역할 "source-transform" 으로 등록하면 그 LUT(uProfile 13)가 내장 변환보다 우선한다. 입력은 §4.0 의 y, 출력은 Rec.709(BT.1886) 표시 신호이며, 이후 §4.11 Rec.709 비디오 경로로 처리한다.
- 두 프로파일에서 "LUT 가 없으면 Rec.709 로 폴백" 하는 동작은 없다.

### §4.13 Samsung Log 피부 마젠타 편향 보정 (S0 직후, WS)
- OKLab(§6.3)으로 변환해 L, C, h 를 구한다.
- w = exp(−0.5·(wrap180(h − 50)/16)²) · smoothstep(0.02, 0.06, C) · (1 − smoothstep(0.85, 1.0, L))
- h' = h + 4·w, C' = C·(1 − 0.04·w)
- 선형으로 되돌린다. 4와 0.04는 실기 차트 측정 전 기본값이며 §14 보정 대상이다.
- 행렬 형식 (GPU·CPU 참조 구현): [a', b'] = M(w)·[a, b], M(w) = (1−0.04w)·[[cos4w°, −sin4w°],[sin4w°, cos4w°]]. 색상 회전 h' = h + 4w 와 채도 배율 C' = C·(1 − 0.04w) 를 함께 적용한 것과 수학적으로 동일하다. 전역 3×3 행렬은 피부 외 색까지 이동시키므로 쓰지 않는다.

### §4.14 RAW (docs/MEDIA_PIPELINE.md §9.3)
- LibRaw 설정 (프록시용, 정확히 이 키들만 지정하고 나머지는 패키지 기본값)
  { halfSize: true, useCameraWb: true, useAutoWb: false, useCameraMatrix: 1, outputColor: 1, outputBps: 16, gamm: [1, 1], noAutoBright: true, highlight: 0, userFlip: 0, userQual: 3, adjustMaximumThr: 0, expCorrec: false }
- 의미: 카메라 WB, 카메라→sRGB(Rec.709 원색, D65) 선형 행렬, 16bit 선형, 자동 밝기 없음, 하이라이트 클립, 회전 없음.
- 출력 v = d/65535 (센서 포화 = 1.0). 원색 srgb(= WS 원색), 전달함수 raw-linear.
- K_raw = 2.04 × 2^BE, BE = metadata(true).color_data.dng_levels.baseline_exposure (유한수가 아니거나 DNG 가 아니면 0).
  x = v · K_raw. 센서 포화가 T_ref 백색에 정확히 대응한다.
- descriptor = { profile:"raw-linear", primaries:"srgb", range:"full", bitDepth:16, rawScale:K_raw }

### §4.15 소스 판별 우선순위 (docs/MEDIA_PIPELINE.md §11.2, 위에서부터 처음 확정된 단계 사용)
- A. 태그: transfer 18 → hlg(원색 rec2020, 자동 적용). transfer 16 → pq, 오류 PQ_UNSUPPORTED("HDR10(PQ) 영상은 지원하지 않습니다").
- B. 메타데이터 문자열: 모든 최상위 박스(mdat, free, skip, wide 제외, 각 최대 8MB)를 ASCII 소문자로 바꿔 검색한다.
  - Sony: /capturegammaequation\s+value\s*=\s*"([^"]+)"/ → g, /capturecolorprimaries\s+value\s*=\s*"([^"]+)"/ → p.
    g 에 "s-log3" → slog3, "s-log2" → slog2, "hlg" → hlg, "rec709"·"itu709"·"s-cinetone" → rec709.
    p 에 "s-gamut3-cine" 또는 "s-gamut3.cine" → s-gamut3-cine, 그 외 "s-gamut3" 또는 "s-gamut" → s-gamut3, "rec2020"·"itu2020" → rec2020, 없으면 프로파일 기본 원색.
  - 일반 부분문자열(우선순위 순): "apple log"|"applelog" → applelog, "f-log2" → flog2, "f-log" → flog, "d-log m"|"d-log-m"|"dlog-m"|"dlogm" → dlogm, "d-log" → dlog, "c-log3"|"canon log 3"|"clog3" → clog3, "v-log" → vlog, "n-log" → nlog, "samsung log" → samsunglog.
  - 자동 적용.
- C. 파일명: 소문자, 확장자 제거, 공백·_·-·. 제거 후 토큰 순서 slog3, slog2, applelog, flog2, flog, dlogm, dlog, clog3, vlog, nlog, samsunglog, hlg. vlog, dlog 는 일반 단어와 겹치므로 제안(자동 적용 안 함), 나머지는 자동 적용.
- D. 히스토그램 제안(자동 적용 안 함): logLike = p0_1 ≥ 0.025 && p99_9 ≤ 0.95 && 0.15 ≤ p50 ≤ 0.65 일 때 제조사(make, 없으면 메타 텍스트에서 samsung, apple, dji, sony, fujifilm, canon, panasonic, nikon 순 첫 일치)로 samsung→samsunglog, apple→applelog, dji→dlogm, sony→slog3, fujifilm→flog2, canon→clog3, panasonic→vlog, nikon→nlog. 제조사가 없으면 vBlack ≤ p0_1 + 0.01 인 프로파일을 vBlack 내림차순(동률은 표 순서)으로 후보를 만들어 첫 후보를 제안한다.
- E. 기본: rec709 (원색 srgb), confidence "default".
- 프로파일 표 (vBlack = 반사율 0 의 Full 확장 신호값, 기본 원색): slog3 0.0354 s-gamut3-cine | slog2 0.0300 s-gamut3 | flog 0.0354 rec2020 | flog2 0.0354 rec2020 | clog3 0.0731 cinema-gamut | vlog 0.0729 v-gamut | nlog 0.0722 rec2020 | dlog 0.0929 d-gamut | applelog 0.1505 rec2020 | hlg — rec2020 | samsunglog — LUT | dlogm — LUT
- samsunglog/dlogm 은 requiresSourceLut=true (§4.12 경로).

### §4.16 소프트 색역 압축 (ACES 1.3 Reference Gamut Compression 식, WS 에 적용, 소스 원색 ≠ srgb 일 때)
- ach = max(r,g,b). ach ≤ 0 이면 그대로.
- d_c = (ach − c)/ach
- 채널별 (lim, thr) = R(1.147, 0.815), G(1.264, 0.803), B(1.312, 0.880), pwr = 1.2
- d < thr 면 그대로. 아니면
  scl = (lim−thr)/((((1−thr)/(lim−thr))^(−pwr) − 1)^(1/pwr))
  nd = (d−thr)/scl
  d' = thr + scl·nd/(1+nd^pwr)^(1/pwr)
- c' = ach − d'·ach
- 골든: [0.5,0.2,−0.1] → [0.5,0.2,0.004294], [0.8,−0.05,0.3] → [0.8,0.035470,0.3]

### §4.17 필름 하이라이트 롤오프 (HLG·Log 소스, uProfile 2~11)
- Y = luma709(max(x,0)). Y ≤ 1 이면 그대로.
- Y' = 1 + 1.04·tanh((Y−1)/1.04), x' = x·Y'/Y  (FSE-v2: 상한이 uRollW = 2.04·2^drStops 로 바뀐다, §19 5-1. DR100 은 이 식과 같다. GPU·CPU 모두 tanh 인자를 min(·, 15) 로 묶는다 — Log 소스 + 고노출에서 Y 가 매우 클 때 GPU tanh NaN 방지, float32 에서 결과 동일)
- 백색 2.04 = T_ref hdrMax 에 점근한다.
- 골든: [2,2,2] → [1.774761 ×3], [6,3,1] → [3.474445,1.737222,0.579074]

## §5 FSH-v1 셰이퍼 (LUT 입력 인코딩)
- 상수: C_S = 0.18·2^−7 = 0.00140625, X_MAX = 16, L_S = log2((X_MAX + C_S)/C_S)
- enc(x) = log2((max(x,0) + C_S)/C_S)/L_S
- dec(u) = C_S·(2^(u·L_S) − 1)
- 골든: L_S = 13.474058, enc(0.18) = 0.520350, enc(1) = 0.703274, dec(0.5) = 0.148600, enc(0) = 0, enc(16) = 1

## §6 (FSE-v2 로 대체됨) 이전 필름 엔진 — renderPoint(x, P)
> **FSE-v2 로 대체됨**: 필름 LUT 생성은 §18 색 전용 커널(scripts/fse2-kernel.mjs renderPoint2)만 쓴다. §6.1(T_ref 톤 계수)·§6.3(OKLab)·§6.6(gamutMap) 의 수식은 앱 공용으로 계속 유효하고, 필름별 톤(§6.1 a·d·hdrMax·midOut, §6.1a 소프트 니)·sat·fade·피부 보호(§6.4)·§6.7 fade 출력은 삭제되었다.
입력 x = [r,g,b] WS 선형(≥0), P = film-params 항목. 출력 = sRGB 인코딩 값 [0,1]³.
- FSE-v1 → FSE-v2 (사용자 승인, "떡보정 제거·실기 SOOC 수준의 자연스러움"): §6.1a 톤 소프트 니 추가, §6.4 피부톤 보호 대역 추가·채도 감쇠 창 확대, §6.5 스플릿 톤 최심부 블랙/최상단 화이트 중립 수렴. 그 밖의 수식(§5 셰이퍼, §6.1 톤 계수, §6.3 OKLab, §6.6 gamutMap, §7 형식)과 T_ref 는 v1 과 같다. 상수는 src/lib/color/fse/constants.mjs 가 진실 원천이다.

### §6.1 톤 계수 (Lottes 2016 형식, MID_IN = 0.18)
- ad = a·d
- b = (hdrMax^a − MID_IN^a/midOut)/(hdrMax^ad − MID_IN^ad)
- c = hdrMax^a − hdrMax^ad·b
- b>0, c>0, d≤1 이어야 한다(단조 증가 보장).
- tone(x) = x ≤ 0 → 0, x ≥ hdrMax → 1, 그 외 min(1, x^a/(x^ad·b + c))
- T_ref = PROVIA 톤 {a:1.3, d:0.92, hdrMax:2.04, midOut:0.19}. 골든: b=0.884006, c=0.452670

### §6.1a 필름 톤 소프트 니 filmTone(x, k) (FSE-v2)
- 목적: SDR 입력은 §4.11 에서 T_ref 로 정규화되므로 원본 = T_ref 다. 필름 톤이 섀도·하이라이트 끝에서 T_ref 보다 세면 이미 대비가 적용된 JPG/HEIC 위에 대비가 한 번 더 얹혀 블랙 크러시·하이라이트 클립(떡보정)이 생긴다. 끝단만 T_ref 쪽으로 되돌려 필름 대비는 중간톤에서만 작동하게 한다.
- yf = tone(x, k_film), yr = tone(x, T_ref), lr = cbrt(yr) (기준 톤의 OKLab L)
- w = KNEE_AMOUNT · max(1 − smoothstep(KNEE_TOE_L0, KNEE_TOE_L1, lr), smoothstep(KNEE_SHOULDER_L, 1, lr))
- filmTone(x) = yf + (yr − yf)·w
- (FSE-v2 로 대체됨 — 코드에서 삭제) 상수: KNEE_AMOUNT = 0.65, KNEE_TOE_L0 = 0.05, KNEE_TOE_L1 = 0.30, KNEE_SHOULDER_L = 0.80
- 필름 톤 = T_ref 이면 filmTone = tone (원본 불변). 32종 모두 [0, 2.6] 에서 단조 증가(tests/step8.reset-fse2.test.ts).

### §6.2 처리 순서
- 컬러 시뮬레이션: y_i = filmTone(x_i) 채널별 → lab = OKLab(y) → colorOps(§6.4) → splitTone(§6.5) → tint(§6.5) → gamutMap(§6.6) → 출력(§6.7)
- 흑백 시뮬레이션: Y = mixer·x → y = filmTone(Y) → lab = OKLab([y,y,y]) → splitTone → tint → gamutMap → 출력

### §6.3 OKLab (Ottosson 2020), 선형 sRGB ↔ OKLab
- 정방향
  l = 0.4122214708r + 0.5363325363g + 0.0514459929b
  m = 0.2119034982r + 0.6806995451g + 0.1073969566b
  s = 0.0883024619r + 0.2817188376g + 0.6299787005b
  l_,m_,s_ = cbrt(l), cbrt(m), cbrt(s) (음수 허용 실수 세제곱근)
  L = 0.2104542553l_ + 0.7936177850m_ − 0.0040720468s_
  a = 1.9779984951l_ − 2.4285922050m_ + 0.4505937099s_
  b = 0.0259040371l_ + 0.7827717662m_ − 0.8086757660s_
- 역방향
  l_ = L + 0.3963377774a + 0.2158037573b
  m_ = L − 0.1055613458a − 0.0638541728b
  s_ = L − 0.0894841775a − 1.2914855480b
  l,m,s = l_³, m_³, s_³
  r = 4.0767416621l − 3.3077115913m + 0.2309699292s
  g = −1.2684380046l + 2.6097574011m − 0.3413193965s
  b = −0.0041960863l − 0.7034186147m + 1.7076147010s

### §6.4 colorOps (색 시뮬레이션 전용)
- C = hypot(a,b), h = atan2(b,a)/DEG, h < 0 이면 h += 360
- 색상 앵커 H = [29, 60, 110, 142, 195, 264, 300, 328] (red, orange, yellow, green, cyan, blue, purple, magenta), σ_H = 22
- d_i = |wrap180(h − H_i)|, w_i = exp(−0.5·(d_i/22)²) / Σ_j exp(−0.5·(d_j/22)²)
- dh = Σ w_i·hue[i][0], g = Σ w_i·hue[i][1], dl = Σ w_i·hue[i][2]
- wc = smoothstep(0, 0.06, C)
- 피부톤 보호 대역 (FSE-v2, OKLCh): wS = skinWeight(h, L, C) = wh·wl·wcs
  wh = smoothstep(25 − 10, 25, h)·(1 − smoothstep(70, 70 + 10, h))
  wl = smoothstep(0.30 − 0.08, 0.30, L)·(1 − smoothstep(0.90, 0.90 + 0.08, L))
  wcs = smoothstep(0.02 − 0.02, 0.02, C)·(1 − smoothstep(0.16, 0.16 + 0.02, C))
  p = 1 − SKIN_PROTECT·wS, SKIN_PROTECT = 0.6 (대역 중심에서 색상 이동·L 이동·채도 증가를 60% 억제)
- G0 = g·sat, G = G0 > 1 ? 1 + (G0 − 1)·p : G0 (채도 감소는 억제하지 않는다)
- h' = h + dh·p·wc
- C' = max(0, C·G·(1 − desat[0]·smoothstep(0.80, 1.0, L))·(1 − desat[1]·(1 − smoothstep(0.06, 0.30, L))))  (L 은 변경 전 값)
  하이라이트 L > 0.80 부터, 섀도 L < 0.30 부터(L < 0.06 에서 최대) 채도가 중립으로 수렴한다. 컬러 필름의 desat 는 두 값 모두 ≥ 0.3.
- L' = L + dl·p·wc
- a' = C'·cos(h'·DEG), b' = C'·sin(h'·DEG)

### §6.5 splitTone / tint
- splitTone (split ≠ null):
  ms = (1 − smoothstep(0.15, 0.55, L))·smoothstep(0, 0.18, L), mh = smoothstep(0.45, 0.95, L)·(1 − smoothstep(0.92, 1.0, L))
  (FSE-v2: 최심부 블랙 L < 0.18 과 최상단 화이트 L > 0.92 는 스플릿 톤 색이 빠져 중립으로 수렴한다. 상수 SPLIT_BLACK_L = 0.18, SPLIT_WHITE_L = 0.92)
  a += sc·cos(sh·DEG)·ms + hc·cos(hh·DEG)·mh
  b += sc·sin(sh·DEG)·ms + hc·sin(hh·DEG)·mh
  ([sh,sc] = split.shadow, [hh,hc] = split.highlight)
- tint (tint ≠ null, [th, tc]):
  m = smoothstep(0, 0.25, L)·(1 − smoothstep(0.85, 1.0, L))
  a += tc·cos(th·DEG)·m, b += tc·sin(th·DEG)·m

### §6.6 gamutMap (소프트 채도 압축, GAMUT_KNEE = 0.85)
- L = clamp(L, 0, 1), C = hypot(a, b)
- C < 1e-9 이면 rgb = oklabToLin(L,0,0) 을 [0,1] 로 clamp 해서 반환
- hr = atan2(b, a) (라디안)
- Cm = maxChroma(L, hr): lo=0, hi=0.5 에서 24회 이분법. inGamut(oklabToLin(L, m·cos hr, m·sin hr)) 이면 lo=m, 아니면 hi=m. 결과는 lo.
  inGamut 은 세 채널 모두 −1e-6 ≤ v ≤ 1+1e-6.
- t = 0.85·Cm
- C > t 이면 r = Cm − t, C_o = (r > 1e-9) ? t + r·tanh((C − t)/r) : t. 그 외 C_o = C.
- rgb = oklabToLin(L, C_o·cos hr, C_o·sin hr) 을 채널별 [0,1] clamp
- GPU 실시간 셰이더: 반복 16회, 허용오차 1e-5. LUT 생성기: 24회, 1e-6
- GPU 수치 안전(FSE-v2 업그레이드 중 추가): 셰이더는 tanh 인자를 min(·, 15) 로 묶는다. float32 에서 tanh(15) = 1 이라 결과는 같고, r 이 아주 작을 때 exp 기반 GPU tanh 가 NaN 이 되는 것을 막는다(이전에는 선명도가 켜진 흰색 하이라이트에 회색 점이 생겼다).

### §6.7 출력
- v_i = clamp(fade[0] + (fade[1] − fade[0])·srgbEnc(rgb_i), 0, 1)

### §6.8 진실 원천
- (FSE-v2 로 대체됨) 파라미터 표: 메타데이터는 src/lib/color/fse/film-params.mjs, 색 파라미터는 scripts/fse2-kernel.mjs SIMS2 (§18)
- 앵커 행 순서: red, orange, yellow, green, cyan, blue, purple, magenta
- hue 행: [색상이동°, 채도배율, OKLab L 이동]

## §7 3D LUT 형식과 샘플링
- 격자: N = 33. 인덱스 (ri,gi,bi), u = idx/(N−1), x = dec(u) (채널별, §5). 파일 순서는 red 가 가장 빠르게, 그다음 green, 그다음 blue.
- .cube 헤더 (LF 줄바꿈, 파일 끝 개행 포함)
  # Generated by scripts/generate-luts.mjs — FSE-v2 / <id>
  # INPUT: scene-linear Rec.709 D65, FSH-v1 shaper (C_S=0.00140625, X_MAX=16)
  # OUTPUT: sRGB IEC 61966-2-1 display-encoded
  TITLE "<en>"
  LUT_3D_SIZE 33
  DOMAIN_MIN 0.0 0.0 0.0
  DOMAIN_MAX 1.0 1.0 1.0
  데이터 행은 "r g b", 각 값 toFixed(6)
- .bin: 헤더 없음. Uint16 little-endian, 값 = round(clamp(v,0,1)·65535), 길이 N³·3, 순서는 .cube 와 동일.
- GPU 업로드: Uint16 → Float32(÷65535) 변환 후 texImage3D(TEXTURE_3D, 0, RGB16F, N, N, N, 0, RGB, FLOAT). MIN/MAG 필터 NEAREST, 래핑 CLAMP_TO_EDGE. 텍스처 x=r, y=g, z=b 인덱스. 셰이더에 precision highp sampler3D; 선언.
- 사면체 보간 (GLSL, CPU 구현 tetra.mjs 도 같은 분기)
  vec3 p = clamp(u, 0.0, 1.0)*float(N-1); ivec3 i = min(ivec3(floor(p)), ivec3(N-2)); vec3 f = p - vec3(i);
  F(dr,dg,db) = texelFetch(lut, i + ivec3(dr,dg,db), 0).rgb; c000 = F(0,0,0); c111 = F(1,1,1);
  if (f.r > f.g) {
    if (f.g > f.b)      { A=F(1,0,0); B=F(1,1,0); w=vec4(1.0-f.r, f.r-f.g, f.g-f.b, f.b); }
    else if (f.r > f.b) { A=F(1,0,0); B=F(1,0,1); w=vec4(1.0-f.r, f.r-f.b, f.b-f.g, f.g); }
    else                { A=F(0,0,1); B=F(1,0,1); w=vec4(1.0-f.b, f.b-f.r, f.r-f.g, f.g); }
  } else {
    if (f.b > f.g)      { A=F(0,0,1); B=F(0,1,1); w=vec4(1.0-f.b, f.b-f.g, f.g-f.r, f.r); }
    else if (f.b > f.r) { A=F(0,1,0); B=F(0,1,1); w=vec4(1.0-f.g, f.g-f.b, f.b-f.r, f.r); }
    else                { A=F(0,1,0); B=F(1,1,0); w=vec4(1.0-f.g, f.g-f.r, f.r-f.b, f.b); }
  }
  out = w.x*c000 + w.y*A + w.z*B + w.w*c111;
- 외부 LUT 입력 도메인 (S8 에서 내장 LUT 대신 사용)
  srgb-display (기본): u = srgbEnc(tone(x_i, T_ref))
  rec709-bt1886: u = tone(x_i, T_ref)^(1/2.4)
  fsh-v1: u = enc(x_i)
  slog3-sgamut3cine: xs = M_WS→S-Gamut3.Cine·x, 그다음 xs ≥ 0.01125 이면 u = (420 + log10((xs+0.01)/0.19)·261.5)/1023, 그 외 u = (xs·(171.2102946929−95)/0.01125 + 95)/1023
  외부 look LUT 출력은 sRGB 표시 인코딩으로 간주한다.
  LUT_IN_VIDEO_RANGE 플래그가 있으면 u' = u·876/1023 + 64/1023. LUT_OUT_VIDEO_RANGE 플래그가 있으면 out' = (out·1023 − 64)/876.
  DOMAIN_MIN/MAX 가 [0,1] 이 아니면 u' = (u − min)/(max − min).

## §8 보정 수식 (Step 3 구현, 슬라이더 값 s = 값/100, 시뮬레이션 shaderHints 는 사용자 값에 더한 뒤 [−1,1] 로 clamp)
### 처리 순서 (사진·비디오·타일 공통, docs/RENDERER.md 섹션 4.1)
- S0 소스→WS: 디코드 → M_src→WS → Samsung 피부 보정(§4.13) → 소프트 색역 압축(§4.16) → 하이라이트 롤오프(§4.17) → 화이트밸런스(Bradford, §8.1) → 노출 2^EV
- S1 HDF 이중 반경 광학 확산(§9) → S2 디헤이즈(§8.3) → S3 베이스 레이어 톤(§8.4) → S4 대비(§8.5) → S5 비네팅 cos⁴θ(장면 선형, §8.11) → S6 음수 제거(§8.6) → S7 필름 3D LUT(사면체) 또는 원본(T_ref) 또는 외부 Look LUT(§5~7) → S8 컬러 크롬 이펙트 / FX 블루(§10) → S9 톤 커브(256×1, §8.7) → S10 채도/생동감(§8.8) → S11 명료도(§8.9) → S12 선명도(언샵 마스크, §8.10) → S13 그레인(§11) → S14 디더·출력(§8.12)
- WB·노출이 HDF 앞으로 이동했다. HDF 발광 임계값을 노출 이후의 밝기 기준으로 쓰기 위해서다.
- shaderHints 는 §15 원터치 마스터 레시피 표에 이미 포함되어 있으므로 렌더러는 shaderHints 를 읽지 않는다(이중 적용 금지).
### §8.1 화이트밸런스 (temp, tint ∈ [−100, 100])
- T_s = clamp(1e6/(1e6/6504 − 0.9·temp), 2000, 25000)
- 흑체 궤적 xy (Kang/Kim 2002)
  T ≤ 4000: x = −0.2661239e9/T³ − 0.2343589e6/T² + 0.8776956e3/T + 0.179910
  T > 4000: x = −3.0258469e9/T³ + 2.1070379e6/T² + 0.2226347e3/T + 0.240390
  T ≤ 2222: y = −1.1063814x³ − 1.34811020x² + 2.18555832x − 0.20219683
  2222 < T ≤ 4000: y = −0.9549476x³ − 1.37418593x² + 2.09137015x − 0.16748867
  T > 4000: y = 3.0817580x³ − 5.8733867x² + 3.75112997x − 0.37001483
- CIE 1960 변환: u = 4x/(−2x + 12y + 3), v = 6y/(−2x + 12y + 3). 역변환: x = 3u/(2u − 8v + 4), y = 2v/(2u − 8v + 4)
- uv_src = uv(D65) + (uv_locus(T_s) − uv_locus(6504)) + (tint/100)·0.02·n̂
  t̂ = normalize(uv_locus(T_s+10) − uv_locus(T_s−10)), n̂ = (−t̂_v, t̂_u). n̂_v < 0 이면 n̂ = −n̂ (녹색 쪽).
- Bradford: M_B = [[0.8951,0.2664,−0.1614],[−0.7502,1.7135,0.0367],[0.0389,−0.0685,1.0296]]
  ρ_s = M_B·XYZ(uv_src, Y=1), ρ_d = M_B·XYZ(D65, Y=1)
  M_CAT = M_B⁻¹·diag(ρ_d/ρ_s)·M_B
  x' = M_XYZ→709·M_CAT·M_709→XYZ·x (CPU 계산 후 mat3 uniform)
- 검증: temp=0, tint=0 이면 단위행렬(±1e-6)
### §8.2 Fast Guided Filter (He 2010/2015, 자기 가이드, 단일 채널 p)
- 프록시: 긴 변 1024px 면적 평균 축소. box_r 는 폭 2r+1 분리형 박스, 가장자리 clamp.
- mp = box_r(p), mpp = box_r(p²), var = mpp − mp², A = var/(var + ε), Bb = mp − A·mp
- mA = box_r(A), mB = box_r(Bb) 를 풀해상도로 쌍선형 업샘플
- q = mA·p_full + mB
### §8.3 디헤이즈 (D ∈ [−100,100])
- 프록시: 긴 변 512px. dc = 7×7 최소필터(min_c x_c)
- A = dc 상위 0.1% 픽셀들의 WS rgb 평균
- t̃ = 1 − 0.95·(7×7 최소필터(min_c(x_c/A_c)))
- t = 가이드 필터(t̃, r=16, ε=0.001) 후 풀해상도 업샘플
- D > 0: k = D/100, t_e = mix(1, max(t, 0.1), k), J = (x − A)/t_e + A
- D < 0: k = −D/100, J = mix(x, A, 0.4·k)
- x' = max(J, 0)
### §8.4 베이스 레이어 톤 (라이트밸런스 S_lb, 쉐도우 S_sh, 하이라이트 S_hi, 흰색 S_wh, 검정 S_bk, 밝기 S_br)
- Y = luma709(x), Yl = log2(max(Y, 2^−20))
- Bs = 가이드 필터(Yl, r = 20 (프록시 1024 기준), ε = 0.25), Dt = Yl − Bs, e = Bs − log2(0.18)
- 마스크
  m_sh = exp(−0.5·((e + 3)/1.5)²)
  m_hi = smoothstep(−0.5, 2.5, e)
  m_wh = smoothstep(1.5, 3.8, e)
  m_bk = 1 − smoothstep(−7, −3, e)
  m_mid = exp(−0.5·(e/1.8)²)
- ΔB = 1.5·S_sh·m_sh + 1.5·S_hi·m_hi + 1.0·S_wh·m_wh + 1.0·S_bk·m_bk + 1.0·S_br·m_mid + 1.2·S_lb·(m_sh − m_hi)
- Y' = 2^(Bs + ΔB + Dt), x' = x·Y'/max(Y, 2^−20). Y ≤ 2^−20 이면 x' = x.
### §8.5 대비 (S_ct)
- e = log2(max(Y, 2^−20)) − log2(0.18), Y' = 0.18·2^(e·(1 + 0.5·S_ct)), x' = x·Y'/max(Y, 2^−20)
### §8.6 음수 제거 (S7)
- Y = luma709(x), n = min(x_r, x_g, x_b)
- n < 0 일 때: Y ≤ 0 이면 x = 0, 그 외 t = Y/(Y − n), x = Y + t·(x − Y)
### §8.7 톤 커브 (S10, 표시 인코딩 v 에 채널별 적용)
- 프리셋 제어점 (in, out)
  선형: (0,0) (1,1)
  약한 대비: (0,0) (0.25,0.22) (0.5,0.5) (0.75,0.78) (1,1)
  강한 대비: (0,0) (0.25,0.18) (0.5,0.5) (0.75,0.83) (1,1)
  매트: (0,0.08) (0.25,0.28) (0.5,0.52) (0.75,0.76) (1,0.96)
  소프트 하이라이트: (0,0) (0.25,0.25) (0.5,0.52) (0.85,0.82) (1,0.94)
- 터치 그래프: 점 최대 12개, x 순증가, 최소 간격 0.02, 양 끝점은 x 고정·y 이동 가능. 그래프 더블탭 = 선형.
- 보간: 단조 3차 Hermite (Fritsch–Carlson 1980)
  δ_k = (y_{k+1} − y_k)/(x_{k+1} − x_k)
  m_0 = δ_0, m_n = δ_{n−1}, 내부 m_k = (δ_{k−1}·δ_k ≤ 0) ? 0 : (δ_{k−1} + δ_k)/2
  δ_k = 0 인 구간은 m_k = m_{k+1} = 0. 그 외 α = m_k/δ_k, β = m_{k+1}/δ_k, α² + β² > 9 이면 τ = 3/sqrt(α² + β²), m_k = τ·α·δ_k, m_{k+1} = τ·β·δ_k
  표준 Hermite 기저로 평가한다.
- 5구간 슬라이더 Z1~Z5 ∈ [−100,100], 중심 c = 0.1, 0.3, 0.5, 0.7, 0.9
  φ_k(x) = |x − c_k| ≤ 0.2 ? 0.5·(1 + cos(π·(x − c_k)/0.2)) : 0
- F(x) = clamp(H(x) + Σ 0.10·(Z_k/100)·φ_k(x), 0, 1)
- 굽기: 256칸 T[i] = F(i/255), 이어서 T[i] = max(T[i], T[i−1]). R16F 256×1 텍스처, LINEAR, 좌표 (v·255 + 0.5)/256.
### §8.8 채도 S, 생동감 V (표시 선형 y = srgbDec(v) 의 OKLab)
- C1 = C·(1 + S/100)
- skin(h) = exp(−0.5·(wrap180(h − 55)/20)²)
- V ≥ 0: g = 1 + (V/100)·(1 − smoothstep(0, 0.20, C))·(1 − 0.5·skin(h))
- V < 0: g = 1 + (V/100)·(1 − 0.5·smoothstep(0, 0.20, C))
- C2 = C1·g, 이어서 gamutMap(§6.6)
### §8.9 명료도 Cl (OKLab L)
- base = 가이드 필터(L, r=30 (프록시 1024 기준), ε=0.004)
- L' = L + 1.2·(Cl/100)·(L − base)·4·L·(1 − L)
### §8.10 선명도 Sh ∈ [0,150] (언샵 마스크, OKLab L, 풀해상도)
- blur = 분리형 가우시안 σ = 1.0px, 커널 반경 3
- Dd = L − blur, Dd' = sign(Dd)·max(|Dd| − 0.004, 0)
- L' = L + (Sh/100)·1.2·Dd'  (FSE-v2: − uIspEs·sstep(0.012, 0.045, |Dd|)·Dd 항이 붙는다, §19 5-5)
### §8.11 광학 비네팅 cos⁴θ (Vg ∈ [−100,100], 장면 선형, S5)
- α = W/H, p = (uv − 0.5)·(α, 1), r = |p|/|(α, 1)·0.5| (모서리 = 1)
- k = |Vg|/100, tanθ = r·k
- f = cos⁴θ = 1/(1 + (r·k)²)²
- Vg < 0 이면 x' = x·f, Vg > 0 이면 x' = x/f
- 골든(종횡비 1.5): uv(0,0) Vg −100 → 0.25, +100 → 4.0, uv(0.25,0.5) Vg −50 → 0.918771, 중심 → 1
### §8.12 출력 디더 (8bit 출력 시)
- 해시 pcg3d (Jarzynski & Olano 2020)
  v = v·1664525u + 1013904223u
  v.x += v.y·v.z; v.y += v.z·v.x; v.z += v.x·v.y
  v ^= v >> 16u
  v.x += v.y·v.z; v.y += v.z·v.x; v.z += v.x·v.y
- n1 = pcg3d(uvec3(x, y, 0)).x/2³², n2 = pcg3d(uvec3(x, y, 1)).x/2³²
- out8 = round(clamp(v + (n1 + n2 − 1)/255, 0, 1)·255)

## §9 HDF — 이중 반경 광학 확산 (S1, WS 장면 선형)
- Y = luma709(x), 발광원 s = x·smoothstep(0.60, 2.00, Y)
  하이라이트만 산란시키므로 암부 블랙과 중간톤 선예도가 유지된다.
- Dg = sqrt(W² + H²) (원본 픽셀 기준)
- 코어 글로우: σc = 0.0035·Dg, 대기 확산(헤일로): σh = 0.022·Dg
- 가우시안 구현: 레벨 n = max(0, floor(log2(σ/2))), 2×2 박스 평균으로 n회 축소, σ_n = σ/2^n, 반경 ceil(3σ_n) 분리형 2패스(RGBA16F), 쌍선형 업샘플
- 프리뷰는 σ 를 프리뷰 해상도 비율로 축소한다.
- out = x − (0.30 + 0.18)·s + 0.30·core + 0.18·halo (에너지 보존 재분배, 무채색 산란)
- 기본 OFF. 리코 탭에서 원터치 토글.

## §10 컬러 크롬 이펙트 / 컬러 크롬 FX 블루 (S9, 컬러 시뮬레이션 전용)
- y = srgbDec(v) → OKLab → L, C, h
- blue(h) = exp(−0.5·(wrap180(h − 264)/28)²)
- CCE 강도 k_e: OFF 0 / 약 0.10 / 강 0.20
  m_e = smoothstep(0.08, 0.20, C)·(1 − blue(h))·smoothstep(0.30, 0.70, L)
- FX Blue 강도 k_b: OFF 0 / 약 0.12 / 강 0.24
  m_b = smoothstep(0.05, 0.16, C)·blue(h)·smoothstep(0.20, 0.60, L)
- L' = L^(1 + k_e·m_e + k_b·m_b). C 와 h 는 유지해 명도만 비선형 압축한다. 이어서 gamutMap(§6.6), srgbEnc.

## §11 은염 클럼핑 그레인 (S15, 표시 인코딩 v)
- 노이즈: 2D 심플렉스 snoise(vec2) — Ashima Arts/Stefan Gustavson webgl-noise(MIT) 구현을 그대로 이식(mod289/permute 버전), 범위 약 [−1,1]
- 파라미터: 강도 A ∈ [0,100], 크기 Sz ∈ [0,100], seed (사진 0, 영상 프레임 번호)
- g0 = max(1, 출력 긴 변 픽셀/3000)
- scale = g0·(1 + 1.5·Sz/100)
- off = (fract(seed·0.754877666)·1000, fract(seed·0.569840291)·1000)
- p = 출력 픽셀좌표/scale + off
- n = (0.72·snoise(p) + 0.28·snoise(p·2.03 + (17.13, 41.71)))·(0.65 + 0.35·snoise(p·0.37 + (3.7, 9.1)))  (2옥타브 + 클럼프 변조)
- vl = 0.2126v_r + 0.7152v_g + 0.0722v_b, resp = sqrt(4·vl·(1 − vl))
- v' = clamp(v + 0.07·(A/100)·resp·n, 0, 1). 세 채널에 같은 n 을 더한다(휘도 그레인).
- 프리뷰 축소율 f 일 때 scale_preview = max(0.5, scale/f)

## §12 원터치 자동 보정 (CPU, S0 직후 긴 변 256px 프록시)
- Y = max(luma709, 1e-6), logAvg = exp(mean(ln Y))
- EV = clamp(0.8·log2(0.18/logAvg), −2, 2)
- EV 적용 후 p99.5 > 2.04 이면 하이라이트 = −clamp(40·log2(p99.5/2.04), 0, 60)
- p2 < 0.18·2^−5 이면 쉐도우 = clamp(20·log2(0.18·2^−5/p2), 0, 50)
- WB: OKLab C < 0.08 이고 0.05 < Y < 0.9 인 픽셀이 전체의 1% 이상이면 그 선형 RGB 평균에 대해 temp, tint 를 −100~100, 2단위 격자 탐색해 §8.1 적용 후 a² + b² 최소인 값을 고른다. 동률이면 |temp| + |tint| 가 작은 쪽.
- 생동감 = +15, 나머지 0. 결과를 슬라이더 값에 기록한다.

## §13 출력·메타데이터 (Step 4)
- sRGB 8bit, §8.12 디더 적용.
- 원본 APP1 Exif 를 바이너리 그대로 재삽입하고 Orientation(0x0112)만 1로 바꾼다.

## §14 보정(캘리브레이션) 프로토콜
1. 실기에서 RAW+JPEG 를 동시 촬영한다. ColorChecker 24, 그레이스케일, 실사 장면. 시뮬레이션별, DR100, WB 고정, NR 0, 샤프니스 0, 그레인·컬러크롬 OFF.
2. RAW → §4.14 → FSE 렌더 결과를 SOOC JPEG 와 패치별 CIEDE2000(Sharma 2005)으로 비교한다.
3. 목표: 24패치 평균 ΔE00 ≤ 2.0, 최대 ≤ 4.0, 그레이 램프 ΔL* ≤ 1.0
4. 조정 범위는 film-params.mjs 수치만 (FSE-v2 수식 상수는 고정): a∈[0.9,2.6], d∈[0.85,1.0], hdrMax∈[1.6,2.6], midOut∈[0.15,0.22], sat∈[0.3,1.5], 색상이동∈[−20,20], 채도배율∈[0.5,1.5], L이동∈[−0.08,0.08]. 최적화는 Nelder–Mead, 초기값은 현재 표.
5. 결과는 docs/calibration/<id>.md 에 측정표와 함께 기록하고 골든값을 재생성한다.

## §15 (FSE-v2 로 대체됨) 원터치 마스터 레시피
> **FSE-v2 로 대체됨**: 중립 RECIPES 표·숨은 레시피 레이어·shaderHints 는 삭제되었다. 필름별 빛·톤·질감은 §20 필름 프리셋(src/lib/render/film-presets.ts)이 슬라이더 값으로 담당한다.
- FSE-v2: 필름의 톤과 색 성격은 오직 3D LUT 가 담당한다. 레시피는 모든 시뮬레이션에서 중립(선명도·명료도·하이라이트·쉐도우·비네팅·그레인 0, 컬러 크롬·FX 블루 끔, HDF 끔)이다. v1 의 숨은 기본 선명화(35~55)·HDR 톤 명료도 등은 LUT 위에 이중으로 얹혀 과보정(떡보정)을 만들었으므로 제거했다. 필름을 고르면 상세 조정 슬라이더는 그대로 두고, 사용자가 원할 때만 슬라이더로 더한다. manifest shaderHints 도 모두 빈 객체다.
- src/lib/render/recipes.ts 가 유일 기준이다. 값 변경은 이 파일과 tests/render.recipes.test.ts 에서만 한다.
- 실효값 = clamp(사용자 + 레시피, 범위) (docs/RENDERER.md 섹션 9.3). 레시피가 중립이므로 실효값 = 사용자 값이다.

## §16 Step 4 추가 사양 (docs/STUDIO.md 가 UI·저장·PWA 를 담당한다)
이 절의 수식과 상수는 Step 4 지시서의 확정 사양을 그대로 옮긴 것이다. 변경은 사용자 승인 후 FSE 버전과 함께 한다.

### §16.1 Samsung Log
- 출처: Samsung Log White Paper (2025), developer.samsung.com/mobile/samsung-log-video.html. 상수는 Samsung 공식 "Samsung Log to Linear 1D LUT v1.0" 과 5.5e-13 이내로 일치한다(colorjs/color-space 의 samsunglog 구현 검증값).
- 정의역: y = CV/1023. uProfile 14 "samsunglog".
- 인코드 x → y: x ≥ 0.01 : y = 0.258984868·log10(x + 0.0003645) + 0.720504856 / −0.05 ≤ x < 0.01 : y = −0.20942·log10(0.016904 − x) − 0.24597 / x < −0.05 : y = 0
- 디코드 y → x: y ≥ 0.206561909 : x = 10^((y − 0.720504856)/0.258984868) − 0.0003645 / 0 ≤ y < 0.206561909 : x = 0.016904 − 10^((y + 0.24597)/−0.20942) / y < 0 : x = −0.05
- 원색 Rec.2020, 백색점 D65. M_2020→709 = [1.660491, −0.587641, −0.072850; −0.124550, 1.132900, −0.008349; −0.018151, −0.100579, 1.118730] (§3.1 표와 원소별 1e-5 이내).
- 레인지: 스트림이 limited(video_full_range_flag = 0 또는 VideoColorSpace.fullRange = false)이면 uLimitedCV = true(y = (v·876 + 64)/1023), full 이면 false, 알 수 없으면 limited. 브라우저 확장값 vBlack = (128 − 64)/876 = 0.0731, vGrey = (540 − 64)/876 = 0.5434.
- 골든(float64, 1e-6) 인코드: 0 → 0.125124 (CV 128), 0.01 → 0.206562 (CV 211), 0.18 → 0.527859 (CV 540), 0.9 → 0.708700 (CV 725), 12 → 1.000000 (CV 1023)
- 골든(상대오차 1e-9) 디코드: 0 → −0.0500028134975, 0.25006105006105006 → 0.0148938833160, 0.5001221001221001 → 0.140581129049, 0.7501831501831502 → 1.30158669211, 0.20659340659340658 → 0.0100029028814, 1 → 12.0000122747
- 골든(GPU float32, 상대오차 1e-4): 디코드 0.2 → 0.009483183, 0.5 → 0.1404282, 0.8 → 2.027080
- 연속성: 분기점 y = 0.206561909 에서 두 디코드 분기의 차 < 1e-6, 두 값 모두 0.01 ± 1e-6.
- 왕복: x ∈ [−0.05, 12] 를 0.001 간격으로 decode(encode(x)) 한 오차 ≤ 1e-9·max(1, |x|). 구현 노트: 분기점의 격자점 x = 0.01 − 5e-18 에서는 인코드가 하위 분기(y = 0.2065619115…)를, 디코드가 상위 분기를 고르므로 사양 상수의 불일치(≈ 2.7e-7)가 드러난다. 이 한 점만 연속성 허용치 1e-6 으로 검사한다(tests/step4.color.test.ts). 사양 상수는 바꾸지 않았다.
- S0 순서: M_src→WS → §4.13 피부 보정(uSamsungFix) → §4.16 → §4.17(uRolloff 켬).

### §16.2 D-Log M Proxy
- DJI 는 D-Log M 수식을 공개하지 않았다(LUT 만 배포). 커뮤니티의 기종별 피팅 수식은 라이선스·정확도가 불명확하므로 쓰지 않는다.
- 내장 기본값은 DJI "D-Log/D-Gamut White Paper" 의 D-Log 곡선(§4.8, uProfile 10)과 D-Gamut 원색이다. UI 에는 반드시 "근사" 를 표시한다.
- D-Log 디코드: y ≤ 0.14 : x = (y − 0.0929)/6.025 / y > 0.14 : x = (10^(3.89616·y − 2.27752) − 0.0108)/0.9892 (§4.8 과 동일)
- D-Log 인코드(테스트용): x ≤ 0.0078 : y = 6.025·x + 0.0929 / x > 0.0078 : y = 0.256663·log10(0.9892·x + 0.0108) + 0.584555
- D-Gamut 원색 R(0.71, 0.31) G(0.21, 0.88) B(0.09, −0.08), 백색점 D65(0.3127, 0.3290). D-Gamut→XYZ = [0.6482, 0.1941, 0.1082; 0.2830, 0.8132, −0.0962; −0.0183, −0.0832, 1.1905]. D-Gamut→WS = [1.674723, −0.579789, −0.094934; −0.098088, 1.333984, −0.235896; −0.040967, −0.242984, 1.283951] (§3.1 표와 원소별 1e-5 이내).
- 골든(상대오차 1e-6) 디코드: 0.0929 → 0, 0.14 → 0.007817427, 0.39877 → 0.1800092, 0.5 → 0.4625340, 0.8 → 6.973398, 1.0 → 41.99939 / 인코드: 0.18 → 0.398765, 1 → 0.584555, 10 → 0.840129

### §16.3 입력 바인딩 표 (resolveInputBinding, src/lib/render/binding.ts)
| 선택 프로파일 | 사용자 LUT | uProfile | uSrcToWS | uLimitedCV | uRolloff | uSamsungFix | 배지 | approximate |
| samsunglog | 등록됨 | 13 | 단위행렬(LUT 출력 = WS) | false(LUT 입력 레인지는 inVR) | false | true | Samsung Log · LUT | false |
| samsunglog | 없음 | 14 | rec2020 | 레인지 규칙(§16.1) | true | true | Samsung Log | false |
| dlogm | 등록됨 | 13 | 단위행렬 | false | false | false | D-Log M · LUT | false |
| dlogm | 없음 | 10 | d-gamut | false | true | false | D-Log M (근사) | true |
- uLimitedCV 는 profile 3~9 와 14 에서, uRolloff 는 profile 2~11 과 14 에서 켠다. 나머지 프로파일은 Step 3 규칙 그대로다.

### §16.4 Film Strength (uFilmStrength = 강도/100)
- vNone = srgbEnc(toneRef(x)) (필름 없음, T_ref), vSim = 필름 LUT 또는 외부 Look LUT 출력.
- 강도 ≥ 1 이면 vSim, 아니면 srgbEnc(mix(srgbDec(vNone), srgbDec(vSim), clamp(강도, 0, 1))). 디스플레이 선형광에서 섞는다. uLutMode 1·2 모두에 적용된다.
- 골든(1e-6): x = [0.3, 0.2, 0.1] → vNone = [0.597581, 0.497974, 0.346606]. vSim = [0.62, 0.40, 0.30], 강도 0.5 → [0.608923, 0.452304, 0.324306].

### §16.5 Mono Toning (uMonoTint)
- uMonoTint = (필름이 mono 이고 monoAmount > 0) ? (C·cos h, C·sin h) : (0, 0), C = 0.06·monoAmount/100, h = monoHue·π/180. 골든(1e-6): (색상 70, 강도 50) → [0.010261, 0.028191], (250, 100) → [−0.020521, −0.056382].
- fs_post(S8~S11)의 OKLab 단계 맨 앞: lab.yz += uMonoTint · smoothstep(0, 0.25, L) · (1 − smoothstep(0.85, 1, L)). 이어서 채도·생동감·명료도, gamutMap, srgbEnc.
- 골든(1e-5): 회색 [0.5, 0.5, 0.5], 강도 50, 색상 70° → [0.547547, 0.489872, 0.426127] / 강도 100, 색상 250° → [0.393596, 0.512882, 0.637721] / 검정 [0, 0, 0] → [0, 0, 0].

### §16.6 HDF Strength (uHdfK = 강도/100, 0..2)
- hdfComposite: out = x + uHdfK·(−0.48·s + 0.30·core + 0.18·halo). uHdfK = 1 이면 §9 와 수학적으로 같다(부동소수 합산 순서만 다름). 기존 HDF 골든은 uHdfK = 1 로 통과해야 한다.

### §16.7 FLA-v1 Auto Light (슬라이더 8개: 노출, 대비, 하이라이트, 쉐도우, 흰색, 검정, 밝기 0, 라이트 밸런스 0)
- 입력: fs_normalize(S0)를 uExpGain = 1, 나머지 S0 설정(입력 바인딩, WB)은 현재 그대로 두고 긴 변 256 RGBA16F 에 그려 읽은 Y = 0.2126R + 0.7152G + 0.0722B. 비디오는 현재 표시 프레임. FLOOR = 2^−14.
- 1) 유한하지 않은 값은 버리고 Y = max(Y, 0), 0개면 전부 0. 2) key = exp(mean(ln(max(Y, FLOOR)))) 3) EV = clamp(0.8·log2(0.18/key), −3, 3) → round(EV/0.05)·0.05 → 소수 둘째 자리 반올림, −0 은 0.
- 4) Z = 오름차순(Y·2^EV), P(q) = max(선형보간 백분위(Z, q), FLOOR), idx = q/100·(n−1). 5) hi = P(99.5) > 1 ? −min(0.6, 0.4·log2 P(99.5)) : 0 6) sh = P(5) < 0.01125 ? min(0.5, 0.25·log2(0.01125/P(5))) : 0 7) wh = clamp(0.3·log2(1/P(99.9)), −0.3, 0.3) 8) bk = P(0.5) > 0.0028125 ? −min(0.3, 0.15·log2(P(0.5)/0.0028125)) : 0 9) S = log2(P(99)/P(1)), ct = clamp(0.6·(7.5/max(S, 1) − 1), −0.25, 0.25)
- 10) 결과: exposure = EV, contrast = round(100·ct), highlights = round(100·hi), shadows = round(100·sh), whites = round(100·wh), blacks = round(100·bk). 색온도·틴트는 바꾸지 않는다. (§12 의 Step 3 CPU 자동 보정은 /lab/renderer 개발 도구에만 남는다.)
- 골든(Y_i, i = 0..999): A Y = 0.02·2^(8i/999) → exposure −0.65, contrast −3, highlights −60, shadows 0, whites −30, blacks −30 / B Y = 0.002·2^(4i/999) → 3, 25, 0, 0, 30, −30 / C Y = 0.05·2^(3i/999) → 0.3, 25, 0, 0, 30, −30 / 빈 배열 → 전부 0.

### §16.8 Histogram (프리뷰, 표시 인코딩 8비트)
- fs_final(uFlipY = false)을 프리뷰 크기 RGBA8 에 한 번 더 그리고, fs_hist 로 긴 변 256(짧은 변 max(1, round(256·짧은/긴)), LINEAR, CLAMP_TO_EDGE)에 다운샘플한 뒤 readPixels 한다.
- 빈: R[r]++, G[g]++, B[b]++, L[round(0.2126r + 0.7152g + 0.0722b)]++. 높이 h_i = min(1, sqrt(bins[i]/M)), M = max(bins[1..254]) (0 이면 max(bins[0..255]), 그것도 0 이면 1).
- 클리핑: t = 0.002·N, shadow = R/G/B[0] ≥ t, highlight = R/G/B[255] ≥ t.
- 골든: 픽셀 [0,0,0],[255,255,255],[128,64,32],[10,200,30],[255,0,0] → R {0:1, 10:1, 128:1, 255:2}, G {0:2, 64:1, 200:1, 255:1}, B {0:2, 30:1, 32:1, 255:1}, L {0:1, 54:1, 75:1, 147:1, 255:1}, shadow·highlight true. bins[0]=500, [10]=100, [100]=25, [255]=900 → h = 1, 1, 0.5, 1.

### §16.9 Area Downsample (저장 시 해상도 축소, 선형광 영역 평균)
- spans(Nin, Nout): r = Nin/Nout, 출력 o 의 구간 [o·r, (o+1)·r), 입력 i ∈ [floor(a), min(Nin, ceil(b))) 마다 cov = min(b, i+1) − max(a, i) > 0 이면 가중치 cov/r. spans(5, 2) = [[[0,0.4],[1,0.4],[2,0.2]], [[2,0.2],[3,0.4],[4,0.4]]].
- DEC[k] = srgbDec(k/255) (Float64Array 256). 출력 인코드 = round(clamp(srgbEnc(acc), 0, 1)·255), 알파 255. 가로 누적 후 세로로 가중해 더하고, 출력 행의 입력 행을 모두 받으면 인코드한다(스트리밍).
- 골든: 5×3 이미지(픽셀 i, RGB = (i·37, i·91, i·13) mod 256) → 2×1 = [141,146,95,255, 127,157,122,255] / 2×1 [0,0,0],[255,255,255] → 1×1 = [188,188,188,255].

### §16.10 ACA-v1 컬러 자동 보정 (컬러 탭, 슬라이더 4개: 색온도, 틴트, 생동감, 채도)
- 입력: fs_normalize(S0)를 WB 항등(Pre-WB)·uExpGain = 1 로 긴 변 256 RGBA16F 에 그려 읽은 WS 선형 RGB (src/lib/studio/color-auto.ts). 비디오는 현재 표시 프레임.
- 유효 픽셀: 세 채널이 모두 유한하고 0.01 ≤ min, max ≤ 0.98 (순백·순흑·클리핑 제외). 유효 수 < 2%·N 이면 보정하지 않는다.
- Robust Gray-World: 유효 픽셀을 OKLab 채도 C = hypot(a, b) 오름차순으로 정렬해 아래 50% 의 선형 RGB 평균 m 을 광원 추정치로 한다.
- 색온도·틴트: wbMatrix(t, k)·m 의 오차 E = (ln R − ln G)² + (ln B − ln G)² (채널 하한 1e−6) 를 최소화하는 정수 (t, k) ∈ [−100, 100]². 격자 10 → (±9, 3) → (±3, 1) 순으로 좁혀 탐색하고 동률이면 |t| + |k| 가 작은 쪽. max(m) ≤ 1e−6 이면 (0, 0).
- 생동감·채도: 확정 WB 를 적용한 유효 픽셀의 평균 OKLab 채도 mC, 피부톤 후보 비율 fs (OKLab L ∈ [0.3, 0.9], C ∈ [0.04, 0.14], 색상 h ∈ [20°, 70°]) 로 d = clamp((0.09 − mC)/0.09, −1, 1), 생동감 = clamp(round(60·d), −20, 60), 채도 = clamp(round(15·d·(1 − min(1, 2·fs))), −10, 15). 피부톤이 많을수록 채도 증가를 억제한다.
- 히스토리 단계 이름은 "컬러 자동 보정". (이 절의 상수 0.01/0.98/50%/0.09/60/15 는 UI 자동 보정용 설계값이며 FSE 엔진 수식이 아니다.)

### §16.11 WB 스포이트
- 사용자가 프리뷰를 탭한 표시 이미지 정규화 좌표 (u, v) → 긴 변 1024 Pre-WB 격자의 픽셀 (floor(u·W), floor(v·H)). 그 주변 5×5 창(경계에서는 잘라냄)의 선형 RGB 평균 s 를 구한다.
- §16.10 과 같은 오차 E 를 최소화하는 (temp, tint) 를 풀어 슬라이더에 즉시 기록한다(Bradford M_wb(§8.1) 역산 = 격자 탐색). 결과 슬라이더 값은 정수, 범위 [−100, 100] 으로 clamp 되므로 범위 밖 광원은 가장 가까운 값이 된다.
- max(s) ≤ 1e−6 이면 적용하지 않는다. 히스토리 단계 이름은 "WB 스포이트".

## §17 FSE-v2 Contract — 역할 분담 계약 (카메라 렌더링 업그레이드 지시서 0-3, 0-4)
| 담당              | 하는 일                                                                                   | 하지 않는 일                         |
|---|---|---|
| 3D LUT (FSE-v2)   | 염료 간섭(3×3 크로스토크), 색상별 3차원 색회전(명도에 따라 달라지는 회전 포함), 색상별 채도 분리, 명부·암부 색분리(스플릿), 흑백 필터 혼합·조색 | 톤(대비·감마·하이라이트·쉐도우·페이드), 전역 채도 |
| 필름 프리셋 슬라이더 | 빛의 톤(라이트 밸런스·노출·밝기·대비·하이라이트·쉐도우·흰색·검정·커브·D레인지), WB 시프트, 전역 채도·생동감, 컬러 크롬, 명료도·선명도·디헤이즈, 그레인, 비네팅, HDF | 색회전·염료 간섭 |
| 카메라 ISP (브랜드 상수) | 필름 숄더, 하이라이트 밀도, 마이크로 할레이션, 존 암부 밀도, 중명부 3D 팝, 광학 윤곽 완화 | 필름별 색 |
- 모든 필름의 LUT 톤은 공통 T_ref 하나다. 무채색(R=G=B) 입력의 LUT 출력 밝기는 필름과 무관하게 T_ref 와 같다.
- ISP 세기는 "브랜드 상수 × 필름 강도/100" 이다. 필름 없음(none)에서는 ISP 가 전부 0 이다. 그래서 none 렌더는 이번 업그레이드 전과 같다.

### §17.1 정직성 표기
- FUJIFILM·RICOH 는 내부 처리(X-Processor, GR ENGINE)를 공개하지 않는다.
- 이 문서의 프리셋 수치·LUT 색 파라미터·ISP 상수는 실기 측정값이 아니다. 공개된 필름 특성 설명과 카메라 설정 체계(하이라이트/쉐도우 톤, 컬러, 클래리티, 그레인, CCE, WB 시프트, D레인지)를 이 앱의 단위로 옮긴 설계값이다.
- docs 와 UI 에 "실기 1:1", "정품 재현" 같은 표현을 쓰지 않는다. UI 표기는 "카메라 렌더링 근사" 로 한다.

### §17.2 렌더 파이프라인 순서 (FSE-v2)
- S0  디코드 → M_src→WS → 삼성 피부 보정 → RGC → 하이라이트 롤오프(상한 uRollW, §19 5-1) → WB → 노출
- S1  HDF(사용자) → MH 마이크로 할레이션(ISP, 5-3)
- S2  디헤이즈
- S3  베이스 톤(슬라이더) + ZS 암부 밀도 + 3D 팝(ISP, 5-4)
- S4  대비 · S5 비네팅 · S6 음수 클립
- S6b FS-DR 필름 숄더(ISP+D레인지, 5-1)
- S7  FSE-v2 LUT → 필름 강도 혼합 → S7b HD 하이라이트 밀도(ISP, 5-2)
- S8  컬러 크롬·FX 블루 · S9 커브 · S10 채도·생동감·흑백 조색 · S11 명료도
- S12 선명도 + ES 광학 윤곽 완화(ISP, 5-5)
- S13 그레인 · S14 디더

## §18 FSE-v2 LUT Kernel (지시서 4-1, 4-4)
정본 코드: scripts/fse2-kernel.mjs (Node 스크립트 전용, 앱 번들에는 들어가지 않음). 색 파라미터의 SSOT 는 이 파일의 SIMS2 하나다.

### §18.1 커널 수식
입력 x = scene-linear WS RGB(≥0), 출력 = sRGB 인코드 디스플레이 RGB.
- 컬러 필름:
  1) 염료 간섭: xd = clipNegLum(M_dye · x). M_dye 는 각 행의 합이 정확히 1 인 3×3 행렬이다(무채색 보존).
     clipNegLum: 최솟값 n < 0 이면 Y = LUMA·x, t = Y/(Y − n), x' = Y + t·(x − Y). Y ≤ 0 이면 0.
  2) 공통 톤: y = (T_ref(xd.r), T_ref(xd.g), T_ref(xd.b)).
     T_ref(x) = x^1.3 / (x^1.196·0.884006171 + 0.452670345), x ≥ 2.04 → 1, x ≤ 0 → 0
  3) OKLab: (L, a, b) = linToOklab(y), C = hypot(a,b), h = atan2(b,a) (도, 0~360)
  4) 앵커 가중치: 앵커 h_i = [29, 60, 110, 142, 195, 264, 300, 328]
     w_i = exp(−0.5·(d_i/22)²) / Σ, d_i = 원형 각거리(h, h_i)
  5) 명도 기울기 변수: τ(L) = clamp((L − 0.55)/0.30, −1, 1)
  6) 앵커 행 [s_i, k_i, g_i, l_i] 에 대해:
     Δh = Σ w_i·(s_i + k_i·τ(L)), g = Σ w_i·g_i, Δl = Σ w_i·l_i, wc = sstep(0, 0.06, C)
     h' = h + Δh·wc
     C' = max(0, C·g·(1 − dH·sstep(0.88, 1.0, L))·(1 − dS·(1 − sstep(0.0, 0.30, L))))
     L' = L + Δl·wc
  7) 색분리: ms = 1 − sstep(0.15, 0.55, L'), mh = sstep(0.45, 0.95, L')
     (a, b) += sC·(cos sh, sin sh)·ms + hC·(cos hh, sin hh)·mh   (split = {shadow:[sh, sC], highlight:[hh, hC]})
  8) gamutMap(24회 이분 탐색, knee 0.85) → clamp → sRGB 인코드
- 흑백 필름:
  Ym = max(0, mixer·x), L = cbrt(T_ref(Ym)), (a,b) = 0
  → 7) 색분리(있으면) → 조색 tint=[th, tC]: m = sstep(0, 0.25, L)·(1 − sstep(0.85, 1, L)), (a,b) += tC·(cos th, sin th)·m
  → gamutMap → sRGB 인코드
- FSE-v1(이전 엔진, §6)에서 빼는 것: 필름별 톤 곡선(a, d, hdrMax, midOut), 전역 채도 sat, preGain, fade(흑점·백점). 이것들은 전부 §20 프리셋 슬라이더(대비·커브·채도·검정)로 옮겼다.
- 생성: scripts/generate-luts.mjs 가 각 격자점에 renderPoint2([dec(i_r/32), dec(i_g/32), dec(i_b/32)], SIMS2[simId]) 를 굽는다(§7 형식 그대로). 32개 simId 가 SIMS2 키·film-params·manifest 와 1:1 이 아니면 exit 1. manifest 각 항목에 "engine": "FSE-v2", tone/sat/fade/preGain/shaderHints 필드 없음.

### §18.2 골든 (커널 함수 출력, 허용오차 1e-6) — tests/fse2.kernel.test.ts
프로브(scene-linear): skin = [0.580411, 0.289008, 0.210126], sky = [0.120523, 0.184135, 0.322443], red = [0.427355, 0.044488, 0.05239], foliage = [0.06, 0.11, 0.035]
출력 순서: skin | sky | red | foliage
- fuji-provia: [0.760553, 0.588426, 0.509247] | [0.381154, 0.478453, 0.620354] | [0.686269, 0.211745, 0.235467] | [0.260040, 0.364933, 0.174115]
- fuji-velvia: [0.770138, 0.563207, 0.481218] | [0.322060, 0.424492, 0.592787] | [0.699534, 0.087969, 0.201263] | [0.240763, 0.358615, 0.110262]
- fuji-astia: [0.765281, 0.596519, 0.515108] | [0.357909, 0.460068, 0.606650] | [0.690625, 0.217880, 0.230256] | [0.261199, 0.363236, 0.176422]
- fuji-classic-chrome: [0.731301, 0.587541, 0.506299] | [0.388284, 0.476859, 0.565565] | [0.629971, 0.255883, 0.226479] | [0.270596, 0.326233, 0.198223]
- fuji-reala-ace: [0.762133, 0.578257, 0.494247] | [0.354481, 0.457516, 0.606559] | [0.693808, 0.161597, 0.206423] | [0.250245, 0.362112, 0.156410]
- fuji-pro-neg-hi: [0.757572, 0.599867, 0.520725] | [0.388414, 0.479372, 0.612194] | [0.673316, 0.241728, 0.237879] | [0.267135, 0.360224, 0.193057]
- fuji-pro-neg-std: [0.751835, 0.602517, 0.526759] | [0.396094, 0.479756, 0.602650] | [0.660454, 0.259388, 0.246981] | [0.257894, 0.360113, 0.215454]
- fuji-classic-neg: [0.759504, 0.568905, 0.486644] | [0.377625, 0.471394, 0.580513] | [0.667388, 0.168609, 0.282451] | [0.216468, 0.356695, 0.206827]
- fuji-nostalgic-neg: [0.785309, 0.595291, 0.465958] | [0.382731, 0.478351, 0.592605] | [0.695757, 0.226291, 0.196850] | [0.280499, 0.359870, 0.184913]
- fuji-eterna: [0.741058, 0.597534, 0.525187] | [0.399715, 0.485034, 0.583543] | [0.641493, 0.273561, 0.267932] | [0.262181, 0.355365, 0.234176]
- fuji-eterna-bleach-bypass: [0.750019, 0.595492, 0.526549] | [0.399897, 0.482211, 0.605375] | [0.667736, 0.256651, 0.264783] | [0.261750, 0.355171, 0.206513]
- fuji-acros, fuji-monochrome: [0.632873 ×3] | [0.473893 ×3] | [0.394411 ×3] | [0.334561 ×3]
- fuji-acros-ye, fuji-monochrome-ye: [0.656349 ×3] | [0.458943 ×3] | [0.456229 ×3] | [0.328496 ×3]
- fuji-acros-r, fuji-monochrome-r: [0.692033 ×3] | [0.441158 ×3] | [0.546093 ×3] | [0.307029 ×3]
- fuji-acros-g, fuji-monochrome-g: [0.622192 ×3] | [0.476029 ×3] | [0.358528 ×3] | [0.341681 ×3]
- fuji-sepia: [0.709342, 0.615130, 0.517502] | [0.545820, 0.456488, 0.363060] | [0.463606, 0.377155, 0.286038] | [0.401408, 0.317394, 0.228074]
- ricoh-standard: [0.760784, 0.588236, 0.509804] | [0.384313, 0.478431, 0.615686] | [0.686274, 0.211765, 0.235293] | [0.260037, 0.364933, 0.174118]
- ricoh-vivid: [0.775335, 0.581126, 0.489369] | [0.345401, 0.456936, 0.614888] | [0.714960, 0.152644, 0.197053] | [0.251352, 0.371989, 0.145573]
- ricoh-positive-film: [0.768967, 0.570774, 0.453277] | [0.319349, 0.437058, 0.597278] | [0.696461, 0.124367, 0.142803] | [0.226595, 0.360313, 0.164606]
- ricoh-negative-film: [0.751828, 0.594719, 0.509714] | [0.394411, 0.483496, 0.588636] | [0.652475, 0.264808, 0.251884] | [0.251201, 0.360209, 0.227511]
- ricoh-bleach-bypass: [0.750020, 0.595492, 0.526549] | [0.399897, 0.482211, 0.605375] | [0.667877, 0.256501, 0.264643] | [0.260780, 0.356224, 0.195748]
- ricoh-retro: [0.767489, 0.593839, 0.479312] | [0.402426, 0.479628, 0.562203] | [0.659075, 0.261966, 0.263723] | [0.287726, 0.355853, 0.199244]
- ricoh-cross-process: [0.779109, 0.584155, 0.423908] | [0.335608, 0.484563, 0.609334] | [0.712086, 0.130747, 0.185958] | [0.275328, 0.380572, 0.178468]
- ricoh-hdr-tone: [0.760784, 0.588236, 0.509804] | [0.384313, 0.478431, 0.615686] | [0.686274, 0.211765, 0.235293] | [0.256187, 0.365552, 0.180367]
- ricoh-monotone, ricoh-soft-monotone, ricoh-hard-monotone, ricoh-hi-contrast-bw: [0.632873 ×3] | [0.473893 ×3] | [0.394411 ×3] | [0.334561 ×3]

무채색 성질:
- split·tint 가 없는 필름은 회색 입력 g ∈ {0.01, 0.18, 2.04} 의 출력이 세 채널 모두 srgbEnc(T_ref(g)) 와 같다(허용오차 1e-6). T_ref 기준값: 0.18 → 0.473121, 0.01 → 0.065758
- 모든 필름에서 회색 입력의 출력 OKLab L 이 cbrt(T_ref(g)) 와 0.01 이내이다. g = 2.04·(i/200)³, i = 1..200 으로 검사한다.

split·tint 필름의 회색 출력(0.18 | 0.01):
- fuji-classic-chrome: [0.474483, 0.472912, 0.470852] | [0.050515, 0.070289, 0.071225]
- fuji-pro-neg-std: [0.473121, 0.473121, 0.473121] | [0.054799, 0.069371, 0.068055]
- fuji-classic-neg: [0.477152, 0.472234, 0.468231] | [0.025010, 0.077194, 0.070282]
- fuji-nostalgic-neg: [0.478178, 0.472435, 0.463926] | [0.073915, 0.063249, 0.059576]
- fuji-eterna: [0.474322, 0.472980, 0.470816] | [0.041838, 0.072406, 0.073935]
- fuji-eterna-bleach-bypass: [0.473121, 0.473121, 0.473121] | [0.054673, 0.068911, 0.071539]
- fuji-sepia: [0.545023, 0.455717, 0.362311] | [0.105446, 0.052596, 0.004338]
- ricoh-positive-film: [0.475543, 0.472704, 0.469388] | [0.049854, 0.069029, 0.080770]
- ricoh-negative-film: [0.475642, 0.472660, 0.469428] | [0.027831, 0.075415, 0.077975]
- ricoh-retro: [0.479123, 0.472677, 0.459501] | [0.081661, 0.061455, 0.045620]
- ricoh-cross-process: [0.475027, 0.474467, 0.458215] | [0.025524, 0.069249, 0.115051]

LUT 굽기 검사: 구운 .bin 을 테트라 보간으로 조회한 값과 커널 직접 계산의 차이가 7개 프로브(회색 0.18, skin, sky, red, foliage, 0.01, 0.9)에서 0.005 이하이다(32종 전부).

## §19 Camera ISP (지시서 5-0 ~ 5-5)
정본 코드: src/lib/render/isp.ts (상수·유니폼), 셰이더 fs_main / lib_ops / fs_normalize / fs_final / fs_mh_extract, CPU 미러 src/lib/render/isp-ops.ts.

### §19.0 상수와 기호
- L: OKLab 명도. 무채색에서는 L = cbrt(디스플레이 선형 Y) 이다.
- ISP_YK = 0.328679008 : T_ref 디스플레이 L = 0.70 (Y_disp = 0.343) 이 되는 scene Y
- ISP_Y88 = 0.840607362 : T_ref 디스플레이 L = 0.88 (Y_disp = 0.681472) 이 되는 scene Y
- ISP_UO = log2(2.04 / ISP_YK) = 2.63381793
- 브랜드 상수: FUJIFILM = X-Processor 5 렌더링 근사, RICOH = GR ENGINE 6 렌더링 근사

| 상수   | 의미                       | FUJIFILM          | RICOH             |
|---|---|---|---|
| hd     | 하이라이트 밀도            | 1.2               | 0.9               |
| mh     | 마이크로 할레이션 세기     | 0.10              | 0.07              |
| mhTint | 할레이션 색                | (1.00, 0.78, 0.58)| (1.00, 0.86, 0.72)|
| sd     | 존 I~II 암부 밀도(stop)    | 0.30              | 0.45              |
| pop    | 존 III~IV 3D 팝 게인       | 0.25              | 0.35              |
| es     | 광학 윤곽 완화             | 0.35              | 0.25              |
- 실제 유니폼 값 = 상수 × (필름 강도/100). 필름 없음이면 0 이다.

### §19.1 (5-1) FS-DR 필름 숄더 (S6b, scene-linear) + S0 롤오프 연동
- D레인지 dRange ∈ {100, 200, 400} → drStops = {0, 1, 2}
- 소스 헤드룸: 디스플레이 기준 소스(profile 0 sRGB 이미지, 1 Rec.709, 13 소스 LUT)는 2.04 를 넘는 정보가 없다 → uSceneRef = false. RAW·Log·HLG(그 외 profile)는 uSceneRef = true.
- Y = LUMA·max(x, 0). drStops = 0 이거나 Y ≤ ISP_YK 이면 그대로 둔다. 그 외:
  Ui = uSceneRef ? ISP_UO + drStops : ISP_UO, n = Ui / ISP_UO (n ≥ 1), u = log2(Y / ISP_YK)
  u' = (u ≥ Ui) ? ISP_UO : ISP_UO·(1 − (1 − u/Ui)^n), x' = x · (ISP_YK·2^u' / Y) (색비 보존)
- 성질: u = 0 에서 기울기 1(무릎이 매끄러움), u = Ui 에서 기울기 0 으로 백점 2.04 에 안착한다. 무릎에서 들어갈 때는 완만하고 끝에서 눕는 비대칭 숄더이다.
- S0 롤오프 연동: Log·HLG 롤오프 상한을 uRollW = 2.04·2^drStops 로 바꾼다(DR100 은 기존과 같은 2.04). 롤오프가 남긴 헤드룸을 FS-DR 이 백점으로 접는다.
- 골든(회색 입력의 출력 채널값, 1e-6): Y=0.2,dr2,sceneRef → 0.2000000 / Y=1,dr0 → 1.0000000 / Y=1,dr1 → 0.9013636 / Y=1,dr2 → 0.8599034 / Y=2.04,dr1 → 1.4995033 / Y=2.04,dr2 → 1.3453431 / Y=4.08,dr1 → 2.04 / Y=8.16,dr2 → 2.04 / Y=20,dr2 → 2.04 / Y=1,dr2,!sceneRef → 1.0000000 / Y=2.04,dr2,!sceneRef → 2.0400000 / 색 [1.2,0.8,0.5],dr2,sceneRef → [1.071563, 0.714376, 0.446485]

### §19.2 (5-2) HD 하이라이트 밀도 (S7b, 디스플레이, 필름 강도 혼합 직후)
- lab = linToOklab(srgbDec(v)). L ≤ 0.70 이면 그대로 둔다. 그 외: t = min(1, (L − 0.70)/0.30), L' = 0.70 + 0.30·(t − uIspHd·t²·(1 − t)²)
- a, b 는 그대로 둔다(명도만 눌러 채도 밀도가 오른다). 그다음 v' = srgbEnc(gamutMap(L', a, b)).
- 성질: L = 0.70 과 L = 1.0 에서 기울기 1, 백점 1.0 유지. hd ≤ 1.2 에서 단조 증가(최소 기울기 0.769).
- 골든(1e-5): 회색 L=0.6 → L' 0.600000, v' 0.502111 / L=0.75 → 0.743056, 0.672829 / L=0.85 → 0.827500, 0.777650 / L=0.95 → 0.943056, 0.925447 / L=1 → 1, 1 (hd 1.2). 색 v=[0.95,0.80,0.60]: hd 1.2 → [0.921202, 0.772123, 0.572991], hd 0.9 → [0.928386, 0.779076, 0.579727]

### §19.3 (5-3) MH 마이크로 할레이션 (S1, scene-linear, HDF 와 별개로 항상)
- emitMh(x) = max(x,0) · sstep(ISP_Y88, 2.04, Y), Y = LUMA·max(x,0)
- 블러 패스(uIspMh > 0 일 때만): σ_mh = 0.0010 · hypot(uImageSize.x, uImageSize.y) (이 렌더의 px 단위)
  1) fs_mh_extract: 반 해상도에서 2×2 평균한 emitMh. 이때 단계 ℓ = 1.
  2) ceil(3·σ_mh/2^ℓ) ≤ 12 가 될 때까지 fs_down2 로 한 단계씩 줄이고 ℓ 를 1 씩 올린다.
  3) σ_ℓ = σ_mh/2^ℓ, 반경 = max(1, ceil(3·σ_ℓ)) 로 기존 fs_gauss 를 가로·세로 두 번 적용한다.
  4) 결과 텍스처 uMH 는 HDF core 와 같은 규칙으로 로컬 uv(bilinear)로 샘플한다.
- 합성: x' = x + uIspMh·(uIspMhTint ⊙ B_mh − 0.25·emitMh(x)). fs_prep(분석 패스)에는 넣지 않는다.
- 3·σ_mh 가 기존 HDF halo 블러 범위·타일 패딩보다 작으므로 타일 패딩은 바꾸지 않는다(테스트로 확인, ℓ ≤ HDF core 레벨이라 타일 정렬도 공유).
- 골든(1e-6): emitMh([0.84]×3) = 0, emitMh([1.5]×3) = [0.861617]×3, emitMh([3,2,1]) = [3,2,1]; 합성 x=[1.5]×3, B=[0.6]×3, FUJIFILM → [1.538460, 1.525260, 1.513260]; x=[0.05]×3, B=[0.3,0.2,0.1], RICOH → [0.071000, 0.062040, 0.055040]; 6000×4000 → σ 7.2111, ℓ 1, 반경 11

### §19.4 (5-4) ZS 존 암부 밀도 + 3D 팝 (S3, 베이스 톤 함수 안)
- 베이스 톤 함수의 기존 변수: Bs(guided filter 베이스 log2), Dt = Yl − Bs(디테일), e = Bs − log2(0.18)
- msd = exp(−0.5·((e + 3.5)/1.0)²) (존 I.5 중심), mz = exp(−0.5·((e + 1.5)/1.2)²) (존 III.5 중심)
- dB = (기존 슬라이더 항) − uIspSd·msd, Dt' = Dt + uIspPop·mz·Dt / (1 + (Dt/0.6)²), Y' = 2^(Bs + dB + Dt')
- 베이스만 내리고 디테일은 보존하므로 암부가 회색으로 뭉개지지 않는다. 색비 보존 스케일이라 탁해지지 않는다. uIspSd > 0 또는 uIspPop > 0 이면 uToneOps(guided filter)를 켠다.
- 골든(회색 입력, 슬라이더 0, 1e-6): (Y 0.0159, Bs log2 0.0159, sd 0.3) → 0.0129148 / (sd 0.45) → 0.0116395 / (Y 0.18, Bs 0.18, sd 0.3) → 0.1799181 / (Y 0.06, Bs 0.05, pop 0.25) → 0.0622403 / (pop 0.35) → 0.0631597 / (Y 0.5, Bs 0.25, pop 0.25) → 0.5059636

### §19.5 (5-5) ES 광학 윤곽 완화 (S12, 디스플레이 L)
- 기존 선명도 블록의 D = L − blurL(σ=1): L' = L + (선명도/100)·1.2·Dp − uIspEs·sstep(0.012, 0.045, |D|)·D
- 큰 진폭의 1px 고주파(디지털 헤일로)만 줄이고 작은 진폭 질감(|D| < 0.012)은 건드리지 않는다.
- 이미 샤프닝된 소스(profile 0, 1)에만 적용한다. RAW·Log 는 0 이다.
- uIspEs 에 렌더 배율 min(1, renderScale) 을 곱한다. renderScale = 이 렌더의 이미지 폭 / 풀해상도 표시 폭 (프리뷰: 캔버스 백킹 폭/풀 폭, 사진 타일 저장: 1, 디테일 오버레이: 배율 s, 동영상 저장: 출력 폭/표시 폭).
- uSharpen > 0 또는 uIspEs > 0 이면 blurL 패스를 계산한다.
- 골든: (L 0.5, D 0.06, es 0.35) → 0.479000, (0.5, 0.02, 0.35) → 0.498965, (0.5, 0.005, 0.35) → 0.500000, (0.5, −0.06, 0.25) → 0.515000

### §19.6 유니폼 골든 (ispUniforms)
- (fujifilm, 100, DR200, profile 0, scale 1) → hd 1.2, mh 0.1, tint [1,0.78,0.58], sd 0.3, pop 0.25, es 0.35, drStops 1, sceneRef false, rollW 4.08
- (ricoh, 50, DR400, profile 12, scale 1) → hd 0.45, mh 0.035, tint [1,0.86,0.72], sd 0.225, pop 0.175, es 0, drStops 2, sceneRef true, rollW 8.16
- (null, 100, DR100, profile 0, scale 1) → 전부 0, tint [1,1,1], drStops 0, sceneRef false, rollW 2.04
- (fujifilm, 100, DR100, profile 1, scale 0.5) → es 0.175, drStops 0, rollW 2.04

## §20 Film Presets (지시서 6-3)
32종 프리셋 표의 SSOT 는 **src/lib/render/film-presets.ts** (FILM_PRESETS, NEUTRAL_PRESET, PRESET_KEYS) 이다. 이 문서에 값을 복제하지 않는다. LUT(§18)는 색만, 이 표는 빛·톤·질감만 담당한다.
선택 규칙 (리듀서 순수 함수 selectFilm, resetForNewMedia — src/lib/studio/state.ts):
- selectFilm(id): id 가 null 이 아니면 PRESET_KEYS 의 모든 값을 FILM_PRESETS[id] 로 통째로 교체한다. id 가 null(필름 없음)이면 NEUTRAL_PRESET 으로 교체한다. 이전 필름의 값은 하나도 남기지 않는다. filmStrength, monoHue, monoAmount, 입력 색공간은 바꾸지 않는다.
- 이미 선택된 필름 카드를 다시 탭하면 selectFilm(같은 id) 를 실행하고(사용자 가감값을 프리셋으로 되돌림) 토스트 "{필름 한글명} 기본 보정을 다시 적용했습니다" 를 띄운다.
- resetForNewMedia(): 새 파일이나 데모를 열 때 simId = null, NEUTRAL_PRESET, filmStrength 100, monoHue 0, monoAmount 0, 입력 색공간 Auto 로 둔다.
- 데모 사진은 resetForNewMedia() 다음 selectFilm('fuji-classic-chrome') 만 실행한다.
- 슬라이더 더블탭 기본값: defaultFor(key) = (simId ? FILM_PRESETS[simId] : NEUTRAL_PRESET)[key].
- 자동 보정(FLA-v1)은 지금처럼 라이트 8개 값만 바꾼다. 커스텀 레시피 적용은 레시피 값으로 전체 교체한다(selectFilm 을 거치지 않는다).
- 키 대응(6-2): temperature→temp, colorChrome→cce, colorChromeBlue→ccb, sharpen→sharpness, hdfEnabled→hdf, toneCurve→curve, 그 밖의 키는 같은 이름(dRange 신규). 커브 preset ≠ 'custom' 이면 points = Step 3 CURVE_PRESETS[대응 키] (linear→linear, medium→weak-contrast, strong→strong-contrast, matte→matte, softHighlight→soft-highlight), zones 그대로.
- 범위(6-6): 모든 프리셋 값은 슬라이더 표를 통과한다(normalizeValue(key, v) === v). dRange ∈ {100, 200, 400}, colorChrome·colorChromeBlue ∈ {0, 1, 2}, custom 커브 points 는 x 가 0 에서 시작해 1 로 끝나고 엄격히 증가하며 2~8개 (tests/fse2.presets.test.ts).

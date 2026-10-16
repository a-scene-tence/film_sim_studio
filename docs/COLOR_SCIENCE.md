# COLOR_SCIENCE.md — Film Lab 컬러 사이언스 명세 (FSE-v1)

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
- 공개 폐형식 수식을 확보하지 못했으므로 상수를 하드코딩하지 않는다.
- 처리 경로: 사용자가 제조사 공식 변환 LUT(.cube, Log → Rec.709)를 역할 "source-transform" 으로 1회 등록한다. 입력은 §4.0 의 y, 출력은 Rec.709(BT.1886) 표시 신호이며, 이후 §4.11 Rec.709 비디오 경로로 처리한다.
- 공식 백서 수식을 사용자가 제공하면 §4.x 로 추가하고 버전을 올린다.

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
- Y' = 1 + 1.04·tanh((Y−1)/1.04), x' = x·Y'/Y
- 백색 2.04 = T_ref hdrMax 에 점근한다.
- 골든: [2,2,2] → [1.774761 ×3], [6,3,1] → [3.474445,1.737222,0.579074]

## §5 FSH-v1 셰이퍼 (LUT 입력 인코딩)
- 상수: C_S = 0.18·2^−7 = 0.00140625, X_MAX = 16, L_S = log2((X_MAX + C_S)/C_S)
- enc(x) = log2((max(x,0) + C_S)/C_S)/L_S
- dec(u) = C_S·(2^(u·L_S) − 1)
- 골든: L_S = 13.474058, enc(0.18) = 0.520350, enc(1) = 0.703274, dec(0.5) = 0.148600, enc(0) = 0, enc(16) = 1

## §6 FSE-v1 필름 엔진 — renderPoint(x, P)
입력 x = [r,g,b] WS 선형(≥0), P = film-params 항목. 출력 = sRGB 인코딩 값 [0,1]³.

### §6.1 톤 계수 (Lottes 2016 형식, MID_IN = 0.18)
- ad = a·d
- b = (hdrMax^a − MID_IN^a/midOut)/(hdrMax^ad − MID_IN^ad)
- c = hdrMax^a − hdrMax^ad·b
- b>0, c>0, d≤1 이어야 한다(단조 증가 보장).
- tone(x) = x ≤ 0 → 0, x ≥ hdrMax → 1, 그 외 min(1, x^a/(x^ad·b + c))
- T_ref = PROVIA 톤 {a:1.3, d:0.92, hdrMax:2.04, midOut:0.19}. 골든: b=0.884006, c=0.452670

### §6.2 처리 순서
- 컬러 시뮬레이션: y_i = tone(x_i) 채널별 → lab = OKLab(y) → colorOps(§6.4) → splitTone(§6.5) → tint(§6.5) → gamutMap(§6.6) → 출력(§6.7)
- 흑백 시뮬레이션: Y = mixer·x → y = tone(Y) → lab = OKLab([y,y,y]) → splitTone → tint → gamutMap → 출력

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
- h' = h + dh·wc
- C' = max(0, C·g·sat·(1 − desat[0]·smoothstep(0.88, 1.0, L))·(1 − desat[1]·(1 − smoothstep(0.0, 0.30, L))))  (L 은 변경 전 값)
- L' = L + dl·wc
- a' = C'·cos(h'·DEG), b' = C'·sin(h'·DEG)

### §6.5 splitTone / tint
- splitTone (split ≠ null):
  ms = 1 − smoothstep(0.15, 0.55, L), mh = smoothstep(0.45, 0.95, L)
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

### §6.7 출력
- v_i = clamp(fade[0] + (fade[1] − fade[0])·srgbEnc(rgb_i), 0, 1)

### §6.8 진실 원천
- 파라미터 표: src/lib/color/fse/film-params.mjs
- 앵커 행 순서: red, orange, yellow, green, cyan, blue, purple, magenta
- hue 행: [색상이동°, 채도배율, OKLab L 이동]

## §7 3D LUT 형식과 샘플링
- 격자: N = 33. 인덱스 (ri,gi,bi), u = idx/(N−1), x = dec(u) (채널별, §5). 파일 순서는 red 가 가장 빠르게, 그다음 green, 그다음 blue.
- .cube 헤더 (LF 줄바꿈, 파일 끝 개행 포함)
  # Generated by scripts/generate-luts.mjs — FSE-v1 / <id>
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
- L' = L + (Sh/100)·1.2·Dd'
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
4. 조정 범위는 film-params.mjs 수치만: a∈[0.9,2.6], d∈[0.85,1.0], hdrMax∈[1.6,2.6], midOut∈[0.15,0.22], sat∈[0.3,1.5], 색상이동∈[−20,20], 채도배율∈[0.5,1.5], L이동∈[−0.08,0.08]. 최적화는 Nelder–Mead, 초기값은 현재 표.
5. 결과는 docs/calibration/<id>.md 에 측정표와 함께 기록하고 골든값을 재생성한다.

## §15 원터치 마스터 레시피
- 실기 SOOC 의 공장 기본 설정(그레인 끔, 컬러 크롬 끔, FX 블루 끔, 하이라이트/섀도 톤 0, 샤프니스 0 의 JPEG 엔진 기본 선명화)을 표로 고정한다. 톤과 색 성격은 FSE-v1 LUT 가 담당하고, 레시피는 LUT 밖의 ISP 단계만 정의한다.
- src/lib/render/recipes.ts 가 유일 기준이다. 값 변경은 이 파일과 tests/render.recipes.test.ts 에서만 한다.
- 시뮬레이션을 고르는 순간 레시피가 숨은 레이어로 적용되고 사용자 슬라이더는 0 을 유지한다. 실효값 = clamp(사용자 + 레시피, 범위) (docs/RENDERER.md 섹션 9.3).

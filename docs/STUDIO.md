# STUDIO.md — Step 4 모바일 다크룸 스튜디오 (UI · 저장 · PWA)

수식·상수는 docs/COLOR_SCIENCE.md §16 이 정본이다. 이 문서는 UI 구성, 저장 사양, PWA 캐시 정책, 수동 검증 결과를 기록한다.
(번호는 Step 4 지시서의 절 번호를 따른다. 없는 번호는 구현에 영향이 없는 서술이어서 옮기지 않았다.)

## §0 기존 API 매핑 (지시서의 이름 → 저장소의 실제 이름)

| 항목 | 지시서 이름 | 실제 이름 / 위치 | 비고 |
|---|---|---|---|
| (A) 렌더러 | FilmRenderer | `FilmRenderer.create(canvas, { preserveDrawingBuffer? })` — src/lib/render/renderer.ts | 같은 이름. 내보내기용 컨텍스트만 preserveDrawingBuffer: true |
| (B) 프리뷰 렌더 | — | `renderer.setParams(RenderParams)` → rAF 합침, `renderer.renderNow()` | 사진 렌더 크기 R = 프록시 크기, 비디오 R = 캔버스 CSS 크기 × dpr × tier |
| (B) 타일 렌더 | renderTile | `renderer.renderTile({ rect, outScale }): Promise<Uint8ClampedArray>` (RGBA8, 좌상단 원점, 한 변 ≤ 1024) | 풀해상도 소스는 `getFullResolutionTile(assetId, rect)` 로 타일 단위 로드(전체 버퍼 없음) |
| (B) 타일 패딩 | — | `tilePadding(outFull)` (render/plan.ts) + renderTile 안의 2^core.level 정렬 | seam 0/255 규칙은 Step 3 그대로 |
| (C) 비디오 루프 | — | `VideoSource` (render/video-source.ts, requestVideoFrameCallback) ← `renderer.setVideoSource(asset, file)` | |
| (C) 회전 프로브 | — | `probeVideoOrientation` (render/video-orientation-probe.ts), tkhd 파싱 `parseTkhdRotation`/`orientationFromMatrix` (media/video-probe.ts) | |
| (C) 회전·반전 → orientation | — | **신규** `rotationToOrientation(rotation, flip)` (export/video-plan.ts) | 지시서 대조표와 같고, `orientationFromMatrix` 의 tkhd 표와 일치함을 테스트로 고정 |
| (D) 입력 바인딩 | resolveInputBinding | **추출** `resolveInputBinding(descriptor, userLut)` (render/binding.ts) | 기존 renderer.ts 의 private `profileIndex`/`normalizeUniforms` 를 순수 함수로 뺌 |
| (E) 렌더 파라미터 | RenderParams, buildUniforms | `RenderParams`, `effectiveParams`, `scalarUniforms` (render/params.ts) + **신규** `buildRenderParams(EditState)`, `buildUniforms(EditState, mono)` (studio/uniforms.ts) | `RenderParams.absolute` 추가(아래 §6-3) |
| (F) 레시피 조회 | simRecipe | `recipeFor(simId)` (render/recipes.ts) + manifest `mono` → **신규** `simRecipe(simId, sims)` (studio/state.ts) | 마스터 레시피 표가 manifest shaderHints 를 이미 포함하므로 shaderHints 를 따로 읽지 않는다 |
| (G) 그레인 | — | `grainScalePreview/grainScaleFull(outLong, …, size)`, `grainOffset(seed)` (render/plan.ts) | |
| (H) 사용자 소스 LUT | — | lutStore (`putLut/getLut/listLuts/deleteLut`) + **신규** `registerSourceLut/findSourceLut/removeSourceLut` (lut/sourceLut.ts) | role "source-transform", sourceProfile "samsung-log" / "dji-dlog-m" |
| (I) 미디어 로더 | — | `loadMedia(file, cb) → MediaAsset { kind, proxy, exif, descriptor, detection, histogram, … }` (media-loader.ts) | |
| (I) 메모리 예산 | getMemoryBudget | `getBudget().budgetBytes` (media/budget.ts) | iOS 320MB / Android 448MB / 그 밖 1024MB |
| (I) Log 감지 | — | `detectLog`, `LogDetection` (media/log-detect.ts) | `approximate` 필드 추가 |
| (J) EXIF 삽입 | insertExifIntoJpeg/Png | `insertExifIntoJpeg(outJpeg, payload, outSize)`, `insertExifIntoPng(...)` (exif-manager.ts) | outSize 는 옵션 객체가 아니라 3번째 인자 `{width, height}`. **신규** `inspectOutputExif`, `readExifTags` |
| (K) 벤더 스크립트 | — | `scripts/vendor-libraw.mjs` → **`scripts/vendor-assets.mjs`** (libraw + mozjpeg) | package.json 훅 `predev`/`prebuild`/`postinstall`. public/vendor/ 는 gitignore (libraw 와 동일) |
| (K) verify | — | `npm run lint && npm run test && npm run luts:check && npm run build && npm run check:export` | build = `next build && node scripts/build-sw.mjs` |
| (L) 서드파티 고지 | — | public/licenses/THIRD_PARTY.txt | mediabunny, @jsquash/jpeg(LICENSE 전문), fast-png 추가 |

Step 3 톤 커브 프리셋 키는 지시서의 표기와 달라 실제 키를 쓴다: 선형 `linear`, 필름 S-커브 `weak-contrast`, 매트 페이드 `matte`, 소프트 하이라이트 `soft-highlight`, 고대비 `strong-contrast`.

## §6 슬라이더 표 (SSOT = `SLIDERS`, src/lib/studio/state.ts)

| key | 탭 | 라벨 | min | max | step | 기본 | 표시 | 렌더 매핑 |
|---|---|---|---|---|---|---|---|---|
| filmStrength | 필름 | 필름 강도 | 0 | 100 | 1 | 100 | 100% | uFilmStrength = v/100 |
| lightBalance | 라이트 | 라이트 밸런스 | −100 | 100 | 1 | 0 | +12 / −8 | uLb = v/100 |
| exposure | 라이트 | 노출 | −5 | 5 | 0.05 | 0 | +0.35 EV | uExpGain = 2^v |
| brightness · contrast · highlights · shadows · whites · blacks | 라이트 | 밝기·대비·하이라이트·쉐도우·흰색·검정 | −100 | 100 | 1 | 0 | 부호 정수 | uBr·uCt·uHi·uSh·uWh·uBk = v/100 |
| temp · tint | 컬러 | 색온도·틴트 | −100 | 100 | 1 | 0 | 부호 정수 | uWB = wbMatrix(temp, tint) |
| saturation · vibrance | 컬러 | 채도·생동감 | −100 | 100 | 1 | 0 | 부호 정수 | uSat·uVib = v |
| cce · ccb | 컬러 | 컬러 크롬 이펙트·블루 | 0 | 2 | 1 | 0 | 끔/약/강 | uKe = [0, 0.10, 0.20][v], uKb = [0, 0.12, 0.24][v] |
| monoHue · monoAmount | 컬러 | 흑백 조색 색상·강도 | 0 / 0 | 359 / 100 | 1 | 0 | 40° / 정수 | uMonoTint (COLOR_SCIENCE §16.5) |
| sharpness | 디테일 | 선명도 | 0 | 150 | 1 | 0 | 정수 | uSharpen = v |
| clarity · dehaze | 디테일 | 명료도·디헤이즈 | −100 | 100 | 1 | 0 | 부호 정수 | uClarity·uDehaze = v |
| hdfStrength | 디테일 | 확산 강도 | 0 | 200 | 1 | 100 | 100% | uHdfK = v/100 |
| grainAmount · grainSize | 디테일 | 그레인 강도·크기 | 0 | 100 | 1 | 0 | 정수 | uGrainAmt = v, uGrainScale = grainScale*(size) |
| vignette | 디테일 | 비네팅 | −100 | 100 | 1 | 0 | 부호 정수 | uVig = v |
| zone0..zone4 | 커브 | 블랙/섀도/미드톤/라이트/화이트 | −100 | 100 | 1 | 0 | 부호 정수 | bakeCurve zones[k] (중심 0.1/0.3/0.5/0.7/0.9) |

키는 29개(24 + zone 5). `hdf` 는 토글(기본 false), 곡선은 `curve { preset, points, zones }`. 부호는 U+2212.

### 필름 연동 키 (`simDefaults(simId, iso)`) — FSE-v2 에서 비어 있음
FSE-v2 부터 Step 3 마스터 레시피(render/recipes.ts)는 모든 시뮬레이션에서 중립(0/끔)이라 연동 키가 없다(`simDefaults` = `{}`).
필름을 고르면 상세 조정 슬라이더(선명도·명료도·하이라이트·쉐도우·비네팅·그레인·컬러 크롬·HDF)는 건드리지 않고 그대로 두며,
톤·색 성격은 3D LUT 만으로 낸다(LUT 위 이중 적용 = 떡보정 금지, COLOR_SCIENCE §15). 슬라이더 더블탭은 `defaultFor(key, simId)` = §6 기본값으로 돌아간다.
`selectSim(next)` 은 연동 키 ∪ 규칙을 유지하므로 레시피 표에 값을 다시 넣으면 그대로 연동된다.

### 새 미디어 열기 = 완전 초기화 (`mediaOpenState(demo)`, Studio.openFile)
사용자 파일(사진·RAW·동영상)을 열면 이전 미디어의 편집 내역을 하나도 이어받지 않는다.
- 편집 상태: `initialEditState()` — 필름 없음(원본, simId null), 필름 강도 100%, 모든 슬라이더 §6 기본값(0, 확산 강도 100%), HDF 끔, 톤 커브 linear·구간 0.
- 뷰: 줌/팬 1×(Preview 가 asset.id 변경 시), 원본 비교 끔, WB 스포이트 끔, 입력 색공간 자동.
- 히스토리: `reset` 으로 past/future/드래그 대기 상태를 비우고 타임라인은 "초기 상태" 1개만 남는다.
- 데모 사진만 소개용으로 클래식 크롬 + HDF 로 시작한다(`DEMO_SIM_ID`).

**절대 모드(`RenderParams.absolute = true`)**: Step 3 `effectiveParams` 는 레시피를 숨은 레이어로 사용자 값에 더한다(FSE-v2 에서는 레시피가 중립이라 더해지는 값이 0). 스튜디오는 절대 모드에서 레시피를 더하지 않는다. `absolute = false`(기본)는 Step 3 동작 그대로이고 /lab/renderer 가 쓴다.

## §7 레이아웃 치수
- 루트: position fixed, inset 0, 100dvh, 좌우 padding env(safe-area-inset-*).
- 헤더: 52px + safe-area 위쪽, 좌우 12px. [열기] · 입력 색공간 배지(높이 32px, 터치 영역 44px) · 데모 칩 · EXIF ⓘ · [저장하기](36px, 라운드 18px, 터치 44px).
- 프리뷰: flex 1, 최소 40dvh, 배경 #000. 히스토그램 좌상단 8px 132×72, HDF 토글 우상단 64×32(터치 영역 72×48).
- 탭 패널: clamp(200px, 34dvh, 320px), 좌우 16px. 탭 바: 56px + safe-area 아래쪽, 아이콘 22px + 라벨 11px.
- 가로 모드(가로 > 세로 이고 높이 < 500px): 프리뷰 왼쪽, 오른쪽 360px 열에 탭 패널 + 탭 바.
- 디자인 토큰: --bg #0b0b0c, --panel #141416, --panel-2 #1c1c1f, --line #2a2a2e, --text #f2f2f2, --text-2 #9a9aa0, --accent #ff6a1a, --danger #ff453a.

## §10 저장 — 사진
- 모드: 원본 화질(JPEG 품질 100 · 4:4:4, 또는 PNG 8비트, 해상도 100%) / 용량 압축(100% · 4096px · 2048px 칩, 화질 60~98, 기본 90).
- 출력 크기 `outSize`, 타일 격자 `tileGrid(W, H, 1024)`, 인코더 옵션(mozjpeg), 예상 용량 `est = round(bytesProxy·(N_out/N_proxy)^γ) + exifLen`(γ: JPEG 0.90, PNG 0.95), 파일명 `exportName` 은 src/lib/export/ 에 있고 tests/step4.export.test.ts 가 골든을 고정한다.
- 파이프라인: 메모리 검사(need > 0.8·budget 이면 저장 불가 문구) → 타일 렌더(행 우선, 진행률 0→0.8) → 풀 해상도는 전체 RGBA 버퍼, 축소는 타일 한 줄 밴드를 워커의 스트리밍 영역 다운샘플(선형광)에 투입 → 워커 인코드(0.8→0.97) → EXIF 재삽입·검증(0.97→1).
- EXIF: Orientation = 1, PixelXDimension/YDimension = 출력 크기, IFD1 썸네일 제거, 원본 ICC 는 복사하지 않음(출력은 sRGB). 삽입 후 다시 파싱해 Orientation 과 크기가 틀리면 오류.
- 취소: 타일 사이마다 플래그 확인 + `worker.terminate()`, 토스트 "저장을 취소했습니다". 저장 중에는 프리뷰 렌더를 멈춘다(`renderer.setSuspended`).

## §11 저장 — 동영상
- 계획 `planVideo(file)`: 표시 크기(회전 반영)·fps·코덱·오디오 계획·예상 용량을 모달을 열 때 한 번 계산한다. 순수 부분은 export/video-plan.ts.
- 컨테이너/코덱: MP4(avc → hevc) → WebM(vp9 → vp8) → MediaRecorder 실시간 녹화 → 불가("이 기기는 동영상 인코딩을 지원하지 않습니다").
- 실행: mediabunny 저수준 API(Conversion 미사용). `VideoSampleSink` → `toVideoFrame()` → `renderer.renderExportFrame(frame, orient, grainSeed)` → `CanvasSource.add`. 오디오는 복사(`EncodedPacketSink`)/변환(`AudioSampleSink`)을 비디오와 동시에 펌프하고 같은 t0 를 뺀다. 120fps 등 60 초과는 1/60 격자(`samplesAtTimestamps`)로 리샘플한다.
- 내보내기 렌더러: DOM 에 붙이지 않는 캔버스(W2×H2), `preserveDrawingBuffer: true`. VideoFrame 업로드가 TypeError 면 이후 `createImageBitmap(frame)` 로 업로드한다.
- Wake Lock 을 요청하고 finally 에서 Input·렌더러·Wake Lock 을 해제한다.

## §12 결과 공유 · 다운로드
- 완료 카드: 썸네일(사진) 또는 아이콘(동영상), 파일명, 실제 크기(≥ 1e6 이면 "X.XX MB", 아니면 "N KB"), 해상도, 경고(W1/W2).
- [사진첩에 저장 · 공유]: `navigator.canShare({ files })` 가 참일 때만, 사용자가 탭했을 때만 `navigator.share` 를 부른다(AbortError 무시, 그 밖의 오류는 토스트). iOS 에서만 안내 문구.
- [파일 다운로드]: a[download] + objectURL(60초 뒤 해제). 모달을 닫으면 결과 Blob·objectURL 을 해제한다.

## §14 PWA 캐시 정책
- 빌드: `next build && node scripts/build-sw.mjs`. out/ 전체를 프리캐시한다(`_next` 정적 파일, LUT bin 32개, 모든 .wasm, 데모, 아이콘, 매니페스트, 각 페이지 HTML). 제외: *.map, /luts/cube/*(내보내기용), sw.js, .DS_Store.
- 키는 Vercel cleanUrls 와 같은 깨끗한 URL('/index.html'→'/', '/a/b.html'→'/a/b'). 내비게이션: 프리캐시 → 네트워크 → '/404'. 그 밖의 GET: 프리캐시 → 런타임 캐시 → 네트워크(same-origin 성공 응답은 런타임 캐시에 저장). /luts/, /vendor/, /demo/, /icons/, *.txt 는 쿼리스트링을 무시하고 매칭한다.
- 버전 = (URL, 파일 sha256) 목록의 sha256 앞 16자리. 버전이 바뀌면 이전 캐시를 지운다.
- **워커 스크립트 처리(지시서 템플릿에 대한 유일한 추가)**: Next/Turbopack 은 워커 설정을 워커 URL 의 `#params=` 해시에 담는다. 서비스워커가 캐시 응답을 그대로 돌려주면 응답 URL(해시 없음)이 워커의 `location` 이 되어 부트스트랩이 "Missing worker bootstrap config" 로 죽는다(재현 확인). `request.destination` 이 worker/sharedworker 인 요청은 URL 이 없는 새 `Response` 로 감싸 돌려주어 요청 URL 이 그대로 `location` 이 되게 한다(`forWorker`).
- 등록: 프로덕션에서만. 개발 모드는 기존 등록을 해제한다. 업데이트 토스트 [업데이트]/[나중에], 저장 진행 중이면 끝날 때까지 미룬다. 설치 안내(iOS / beforeinstallprompt)는 각각 1회(localStorage).
- 배포: vercel.json(framework:null, outputDirectory:out, cleanUrls, 헤더). 기존 `/luts/(cube|bin)/(.*)`, `/luts/manifest.json`(no-cache) 규칙은 배열 끝에 유지했다. next.config.ts 의 dev 전용 COOP/COEP `headers()` 는 `next dev` 에서 RAW(libraw) 가 crossOriginIsolated 로 열리게 하는 용도라 남겼다(static export 빌드에는 영향 없음).

## §17 수동 검증 표
환경: 컨테이너의 Chromium(헤드리스, SwiftShader 소프트웨어 WebGL2, WebCodecs 에 avc/hevc 인코더·디코더 없음, VP8/VP9 있음), `npm run build && npm run preview`(http://localhost:4173, Vercel cleanUrls·헤더 재현), Playwright 스크립트. 실기(iPhone/Galaxy/Vercel)는 이 환경에서 할 수 없어 "사용자 확인 필요" 로 남긴다.

| # | 환경 | 절차 | 기대 결과 | 결과 |
|---|---|---|---|---|
| 1 | build + preview | `/`, `/lab/renderer`, `/lab/renderer.html`, `/없는경로` | 200 스튜디오 / 200 / 308→/lab/renderer / 404 페이지 | **확인**: 200 / 200 / 308 Location /lab/renderer / 404 (out/404.html 본문) |
| 2 | preview + 오프라인 | SW 활성(프리캐시 119개) 후 오프라인, 새로고침 | 스튜디오 로드, 데모·필름·JPEG 저장 | **확인**: 오프라인 새로고침이 SW 응답(200)으로 열림, 데모 → 벨비아 선택 → 2048px JPEG 저장 성공(콘솔 오류 0) |
| 3 | 데스크톱 Chrome | 데모 → 32개 필름, HDF, 그레인, 커브 프리셋 | 즉시 반영, 콘솔 오류 0 | **부분 확인**: 32개 썸네일 전부 렌더, HDF·탭 전환·슬라이더 동작, 콘솔 오류 0. 프리셋 5종 개별 순회는 사용자 확인 필요 |
| 4 | Samsung Log 클립(LUT 미등록) | 열기 → 배지 "Auto · Samsung Log" | Rec.709 폴백 없이 정상 톤, 피부 마젠타 없음 | 사용자 확인 필요 (실제 클립 없음). 데모 사진에서 시트로 Samsung Log 를 고르면 배지 "Samsung Log", 오류 없음 확인 |
| 5 | DJI D-Log M 클립(LUT 미등록) | 배지에서 D-Log M 선택 | "D-Log M (근사)", 정상 톤 | 사용자 확인 필요 (실제 클립 없음). 시트 선택 시 배지 "D-Log M (근사)" 확인 |
| 6 | 같은 클립 + 공식 LUT 등록 | 시트에서 LUT 등록 → 해제 | 배지 "· LUT", 해제 시 복귀 | **확인(UI)**: .cube 등록 → 배지 "D-Log M · LUT", 보조 문구 "등록한 LUT 사용 중: 파일명", LUT 해제 → "D-Log M (근사)". 공식 LUT 의 색 정확도는 사용자 확인 필요 |
| 7 | 24MP JPEG | 원본 화질 JPEG/PNG, 압축 4096/2048 q60/q98 | 해상도·예상 용량 근사, EXIF 유지, Orientation 1, 이음매 없음 | 3000×2000 데모: JPEG 예상 2.1 MB / 실제 1.94 MB, PNG 5.0 / 4.86 MB, 2048px q80 96 KB / 93 KB, EXIF·Orientation 1·PixelDimension·GPS 보존, PNG 에 eXIf·iCCP 없음. 24MP(6000×4000 테스트 패턴 JPEG, 원본 화질 JPEG): 타일 24개, 63 s(SwiftShader 소프트웨어 렌더라 실기보다 훨씬 느림), 예상 7.4 MB / 실제 8.30 MB, 콘솔 오류 0. 4096/q60/q98 개별 조합과 실기 타일 이음매 육안 확인은 사용자 확인 필요 |
| 8 | iPhone Safari/홈 화면 앱 | 사진 저장 → 공유 → 이미지 저장 | 사진 앱에 저장 | 사용자 확인 필요 |
| 9 | Galaxy Chrome | 4K60 MP4(AAC) 저장 | MP4·H.264·AAC 복사, A/V 동기 | 사용자 확인 필요 (이 환경에는 H.264 인코더가 없음). 대신 VP9+Opus WebM 640×360 으로 복사 경로·A/V 길이(3.001 s)·진행 확인 |
| 10 | 세로(회전 90°) 아이폰 영상 | 저장 | 세로로 올바르게 보임, 회전 메타 없음 | 사용자 확인 필요. (회전, 반전)→orientation 표는 tkhd 행렬 표와 일치함을 단위 테스트로 확인 |
| 11 | 120fps 영상 | 저장 | 60 fps, 길이 동일 | **확인**: VP9 120fps 2 s → 출력 60 fps, 121 프레임, 길이 2.017 s, 오디오 복사 |
| 12 | 프리뷰 제스처 | 핀치, 팬, 더블탭, 길게 눌러 원본, 2× 정지 | 디테일 오버레이 선명, 원본 pill | **부분 확인**(마우스): 더블탭 2.5×, 입력 정지 후 디테일 오버레이 표시, 길게 눌러 "원본" pill 표시·해제. 두 손가락 핀치는 단위 테스트(골든)만, 실기는 사용자 확인 필요 |
| 13 | 레시피 | 저장 → 내보내기 → 삭제 → 가져오기 | 동일 값 복원 | **확인**: 가져오기 후 값 동일, 토스트 "레시피 1개 가져옴 · 0개 건너뜀" |
| 14 | Vercel 배포 후 | `/`, `/lab/renderer`, `/없는경로`, `/manifest.webmanifest`, `/sw.js` | 200 / 200 / 404.html / 200 manifest+json / 200 no-cache | 사용자 확인 필요 (로컬 preview 에서는 같은 결과 확인) |
| 15 | Vercel 프로젝트 설정 | Root Directory, vercel.json 의 Build/Output 덮어쓰기 | 빌드 로그 "sw.js: N files", out 업로드 | 사용자 확인 필요 |

## Step 5 모바일 개선

- **EXIF 필름 프레임** (`src/lib/export/frame.ts`, `frame-render.ts`): 저장 모달의 `EXIF 여백 프레임 추가` 토글(기본 OFF). 배경 화이트/블랙, 하단 여백형/4면 폴라로이드형. 1줄 = 바디·렌즈, 2줄 = 초점거리·조리개·셔터·ISO·촬영일시 + 필름 배지(예: `RICOH Positive Film + HDF`). 합성은 export 워커에서 하고(시스템 폰트만 사용), 원본 EXIF 는 그대로 재삽입하며 PixelXDimension/YDimension 만 프레임 포함 크기로 갱신, Orientation=1.
- **동영상**: 오디오 트랙이 없거나 오디오 코덱 탐지가 실패해도 저장을 거부하지 않고 비디오만 인코딩한다. MediaRecorder 폴백은 `video/mp4;codecs=avc1,mp4a.40.2` → `video/mp4;codecs=hvc1` → `video/mp4` 를 먼저 시도하고 MP4 가 전혀 안 될 때만 `.webm`.
- **Display P3 출력** (`src/lib/render/output-space.ts`): `(color-gamut: p3)` 와 WebGL2 `drawingBufferColorSpace='display-p3'` 가 모두 가능할 때만 헤더에 `sRGB / P3` 전환이 나타난다. 기본값은 sRGB 이며(GPU↔CPU 기준값 불변), P3 는 화면(캔버스) 출력에만 적용되는 색역 표현 변환(선형 sRGB→선형 P3 행렬, 전달함수 동일)이다. 렌더 수식·LUT 는 바꾸지 않으므로 색 자체는 같고, 저장 파일은 항상 sRGB 다. 색역 확장(P3 안쪽까지 쓰는 LUT/gamutMap)은 COLOR_SCIENCE 수식 확정이 필요해 이번 범위에서 제외했다.

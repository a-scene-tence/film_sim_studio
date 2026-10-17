# CLAUDE.md — Film Lab

## 0. 이 문서의 지위
- 이 저장소에서 일하는 Claude Code의 최상위 규칙. 우선순위: 사용자의 명시적 지시 > CLAUDE.md > docs/COLOR_SCIENCE.md > 그 밖의 판단.
- Step 4 SSOT: docs/STUDIO.md(UI·저장·PWA), docs/COLOR_SCIENCE.md 의 §16(Samsung Log, D-Log M Proxy, Film Strength, Mono Toning, HDF Strength, FLA-v1 Auto Light, Histogram, Area Downsample).
- 색·톤·LUT·셰이더 코드를 작성하거나 수정하기 전에 docs/COLOR_SCIENCE.md 의 해당 절을 반드시 읽는다. 문서에 없는 수식이나 상수가 필요하면 구현을 멈추고 사용자에게 수식 확정을 요청한다. 추정 상수, 대체 알고리즘, 단계 누락은 금지한다.
- 필름 룩을 바꾸는 유일한 경로: 색은 scripts/fse2-kernel.mjs 의 SIMS2 수치 수정 → npm run luts → 골든 테스트값 갱신, 빛·톤·질감은 src/lib/render/film-presets.ts 수치 수정 → 프리셋 테스트 갱신. 커밋 메시지에 근거를 기록한다. src/lib/color/fse/film-params.mjs 는 메타데이터(id·brand·ko·en·mono·순서)만 둔다. FSE 엔진 수식 변경은 사용자 승인 후 버전을 올려서만 한다(현재 FSE-v2 = 색 전용 LUT 커널 + 카메라 ISP + 필름 프리셋, COLOR_SCIENCE §17~§20).

## 1. 제품 요약
- 아이폰·갤럭시에서 링크 또는 홈 화면 추가(PWA)로 쓰는 모바일 퍼스트 웹앱. Next.js App Router + TypeScript + Tailwind, output: "export" 정적 사이트, Vercel 배포.
- 모든 디코딩·렌더링·인코딩은 브라우저 로컬(Web Worker + WebAssembly + WebGL2 + WebCodecs/MediaRecorder)에서 처리한다. 서버 업로드 0, 비행기 모드 100% 동작.
- 입력
  - 사진: ARW, DNG, RAF, CR3, NEF, JPG/JPEG, PNG, WEBP, HEIC
  - 영상: MP4, MOV, WEBM (4K 60fps 프리뷰, 오디오 싱크 유지 인코딩)
  - Log: S-Log3(S-Gamut3.Cine/S-Gamut3), S-Log2, Apple Log, Samsung Log, F-Log2/F-Log, C-Log3, V-Log, N-Log, D-Log M, HLG, Rec.709. 자동 감지 후 상단 배지 1탭 전환.
- 필름 시뮬레이션 32종 (FUJIFILM 20 / RICOH GR 12). 모든 입력을 WS(작업 색공간)로 정규화한 뒤 FSE-v2 3D LUT(33³, 사면체 보간)를 적용한다. 추가로 "원본"(시뮬레이션 없음 = 기준 톤 T_ref만 적용) 옵션을 둔다.
- 셰이더 효과: HDF 이중 반경 광학 확산, 컬러 크롬 이펙트 / FX 블루, 클럼핑 그레인.
- 라이트룸급 보정: 자동, 라이트 밸런스, 노출, 밝기, 대비, 하이라이트, 쉐도우, 흰색, 검정, 색온도, 틴트, 채도, 생동감, 톤 커브(프리셋 5 + 터치 그래프 + 5구간), 선명도, 명료도, 디헤이즈, 비네팅. 모든 슬라이더는 더블탭 시 0으로 초기화.
- EXIF 전체 표시, 저장 시 원본 EXIF 100% 재삽입(Orientation 만 1). 저장 모드 2종 [원본 화질(100% 해상도, PNG 무손실 또는 JPEG q=1.0)] / [압축(해상도·화질 슬라이더 + 예상 용량)]. Web Share API 로 사진첩 저장.

## 2. 절대 규칙
1. 사용자 미디어를 서버로 보내는 코드, 서버에서 실행되는 코드를 만들지 않는다. output: "export" 를 유지한다.
2. 런타임 제3자 도메인 요청 금지(폰트·CDN·분석 포함). WASM, 워커, LUT, 아이콘은 모두 동일 출처에서 제공한다.
3. 오프라인: Service Worker 가 앱 셸, JS/CSS, WASM, public/luts/bin/*.bin, public/luts/manifest.json 을 프리캐시한다. .cube 는 내보내기용이며 프리캐시하지 않는다. 정적 자산을 추가하면 프리캐시 목록에 등록한다.
4. 디코딩, 파싱, 인코딩, EXIF, 해시 계산은 Web Worker 에서 한다. 메인 스레드를 50ms 이상 블로킹하지 않는다.
5. 렌더 중간 버퍼는 RGBA16F. 선형 데이터를 8bit 로 저장하지 않는다. sRGB 인코딩은 표시/출력 직전 한 번만.
6. 결정론: 같은 입력 + 같은 파라미터 = 같은 출력. 생성 산출물에 타임스탬프나 무작위값을 넣지 않는다(그레인·디더는 명세된 해시/시드 사용).
7. 모바일 UI: 터치 타깃 ≥ 44×44 CSS px, env(safe-area-inset-*) 대응, 다크 UI 기본, 한국어 UI 문구.
8. 의존성은 MIT/BSD/Apache-2.0/ISC/Zlib 라이선스만 허용한다(LGPL WASM 은 별도 파일 동적 로드일 때만 허용). 추가 시 라이선스와 번들 증가량을 보고한다.
   MPL-2.0 은 수정하지 않은 npm 의존성으로 설치해 import 하는 경우에만 허용한다(현재 mediabunny 1개). MPL-2.0 소스 파일을 저장소에 복사·수정·벤더링하는 것은 금지한다. 고지 파일에 이름·버전·라이선스·소스 URL 을 기재한다.
9. 모든 커밋 전에 npm run verify 를 통과시킨다.
10. 공개 API 는 src/lib/media-loader.ts, src/lib/exif-manager.ts 두 파사드다. UI 는 내부 모듈을 직접 import 하지 않는다.
11. libraw-wasm 은 /vendor/libraw-wasm/1.6.0/ 정적 경로 + nativeImport 로만 로드한다. crossOriginIsolated 가 아니면 RAW 는 내장 프리뷰 전용으로 연다.
12. 활성 미디어는 1개다. 새 파일을 열면 이전 자산의 ImageBitmap·버퍼·LibRaw 인스턴스를 즉시 해제한다.
13. 셰이더를 수정하면 tests/render.shaders.test.ts 와 /lab/renderer 의 GPU↔CPU 프로브가 모두 PASS 여야 한다.
14. 배포: Vercel 은 vercel.json 의 framework:null + outputDirectory:'out' 으로 정적 배포한다. next.config 의 output:'export', trailingSlash:false, images.unoptimized:true 를 바꾸지 않는다.
15. 서비스워커: out/sw.js 는 scripts/build-sw.mjs 가 scripts/sw-template.js 로 생성한다. 생성물을 손으로 고치지 않는다.
16. LUT 에 톤을 넣지 않는다(공통 T_ref 만).
17. 필름별 톤·질감은 film-presets.ts 에만 둔다.
18. 숨은 필름별 셰이더 파라미터를 만들지 않는다(ISP 는 브랜드 상수 2벌뿐).

## 3. 기술 스택 (설치된 실제 버전)
- next 16.4.2, react 19.3.0, typescript 5.9.3, tailwindcss 4.3.3, idb 8.0.4, fast-png 8.0.0, libraw-wasm 1.6.0, heic2any 0.0.4, exifr 7.1.3, piexifjs 1.0.6, vitest 5.0.5, Node 22.22.0

## 4. 디렉터리 구조 ([S1]=Step 1 생성, [S2]~[S4]=예정)
- CLAUDE.md, docs/COLOR_SCIENCE.md [S1], docs/calibration/ [S2+]
- scripts/generate-luts.mjs [S1], scripts/fse2-kernel.mjs (FSE-v2 색 전용 LUT 커널, Node 전용)
- src/lib/color/fse/constants.mjs, engine.mjs, film-params.mjs, tetra.mjs [S1] — Node 생성기와 앱이 공유하는 순수 JS(ESM + JSDoc 타입)
- src/lib/lut/ [S1] types.ts, parseCube.ts, parseHald.ts, binLut.ts, lutStore.ts
- src/workers/lut-parse.worker.ts [S1]
- src/app/lab/luts/page.tsx [S1]
- public/luts/manifest.json, public/luts/cube/*.cube, public/luts/bin/*.bin [S1, 생성물 커밋]
- src/lib/media-loader.ts [S2] — 메인 스레드 파사드, src/lib/exif-manager.ts [S2] — EXIF 파사드
- src/lib/media/ [S2] types.ts, errors.ts, sniff.ts, budget.ts, binary.ts, jpeg.ts, tiff.ts, isobmff.ts, ebml.ts, riff.ts, png-chunks.ts, icc.ts, orientation.ts, resample.ts, image-decode.ts, heic.ts, raw-preview.ts, libraw-loader.ts, raw-decode.ts, video-probe.ts, video-frame.ts, histogram.ts, log-detect.ts, rpc.ts (+ 구현 보조: proxy-rows.ts, heic-primaries.ts)
- src/lib/exif/ [S2] binstr.ts, extract.ts, summary.ts, display.ts, dict.ts, serialize.ts, insert-jpeg.ts, insert-png.ts, xmp.ts, iptc.ts, crc32.ts
- src/lib/color/source/ [S2] primaries.mjs, transfer.mjs, normalize.mjs (소스 정규화 §3·§4, 외부 의존성 0)
- src/workers/media-decode.worker.ts [S2], src/app/lab/media/page.tsx [S2]
- scripts/vendor-assets.mjs [S2, S4 일반화] (public/vendor/ 는 설치 시 생성, 커밋 금지), public/licenses/THIRD_PARTY.txt [S2], docs/MEDIA_PIPELINE.md [S2]
- tests/fixtures/exif-ii.jpg.b64 [S2], tests/helpers/ [S2]
- src/app/manifest.ts, src/app/not-found.tsx, public/icons/, public/demo/ [S4], scripts/build-sw.mjs + sw-template.js, serve-out.mjs, check-export.mjs, generate-icons.mjs, generate-demo.mjs [S4], vercel.json [S4]
- src/lib/render/ (WebGL2 멀티패스 렌더러, glsl/ = GLSL ES 3.00 정본, docs/RENDERER.md) [S3], isp.ts·isp-ops.ts (카메라 ISP), film-presets.ts (32종 필름 프리셋 SSOT), src/components/editor/ [S3], src/app/lab/renderer/page.tsx [S3]
- src/lib/studio/ (편집 상태·레시피·자동 보정·히스토그램·제스처) [S4], src/components/studio/ (모바일 스튜디오 UI) [S4], src/lib/export/ (사진·동영상 저장, mediabunny, mozjpeg) [S4], src/workers/export.worker.ts [S4], src/lib/pwa/ [S4], docs/STUDIO.md [S4]
- tests/ [S1+]

## 5. 렌더 파이프라인 (순서 고정, 수식은 docs/COLOR_SCIENCE.md)
S0 소스→WS: 디코드 → M_src→WS → Samsung 피부 보정 → 소프트 색역 압축 → 하이라이트 롤오프(상한 uRollW) → 화이트밸런스(Bradford) → 노출 2^EV
S1 HDF 이중 반경 광학 확산 → MH 마이크로 할레이션(ISP)
S2 디헤이즈
S3 베이스 레이어 톤(라이트 밸런스, 쉐도우, 하이라이트, 흰색, 검정, 밝기) + ZS 암부 밀도 + 3D 팝(ISP)
S4 대비
S5 비네팅 cos⁴θ(장면 선형)
S6 음수 제거
S6b FS-DR 필름 숄더(ISP + D레인지)
S7 필름 3D LUT(사면체, FSE-v2 색 전용) 또는 원본(T_ref) 또는 외부 Look LUT → 필름 강도 혼합 → S7b HD 하이라이트 밀도(ISP)
S8 컬러 크롬 이펙트 / FX 블루
S9 톤 커브(256×1)
S10a 피부톤 세부 조정(STC-v1 3D 피부 마스크, COLOR_SCIENCE §8.8b, 세 값 0 이면 바이패스)
S10 채도/생동감
S11 명료도
S12 선명도(언샵 마스크) + ES 광학 윤곽 완화(ISP)
S13 그레인
S14 디더·출력

## 6. 브라우저 기준
- iOS Safari 16.4+, Android Chrome 120+.
- WebGL2 필수. RGBA16F 렌더 타깃은 EXT_color_buffer_float, 없으면 EXT_color_buffer_half_float. 둘 다 없으면 미지원 안내 화면을 띄운다(8bit 폴백 금지).
- 3D LUT 은 texelFetch + 수동 사면체 보간이라 float 선형 필터링 확장이 필요 없다.
- WebCodecs 는 기능 탐지 후 사용하고, 없으면 MediaRecorder 로 폴백한다.

## 7. 코딩 규칙
- TS strict, any 금지, named export. 색 수학은 src/lib/color/fse/*.mjs 한 곳에만 두고 GLSL 은 같은 상수를 uniform/define 으로 주입한다(상수 중복 정의 금지).
- 워커는 new Worker(new URL("../workers/x.worker.ts", import.meta.url), { type: "module" }) 패턴. 큰 버퍼는 transfer 로 넘긴다.
- 사용자 대면 오류 문구는 한국어로, 원인과 해결 방법을 함께 적는다.

## 8. 테스트
- vitest. 색 엔진은 골든값 테스트(tests/fse.*.test.ts)로 고정한다. 골든값 변경은 film-params 변경 커밋에서만 허용한다.
- 생성물 결정론: npm run luts:check 가 커밋된 LUT 의 sha256 과 재생성 결과를 비교한다.

## 9. Git
- Conventional Commits (feat/fix/refactor/test/docs/chore), 설명은 한국어.
- force push 금지. out/, .next/, node_modules/ 커밋 금지.

## 10. 로드맵
- Step 1: 초기화, 문서, FSE-v1 32종 LUT 생성기, 외부 .cube/HaldCLUT 업로더(파싱·저장·CPU 미리보기)
- Step 2: 통합 미디어 로더(RAW/JPEG/PNG/WEBP/HEIC/MP4/MOV/WEBM, 프록시 2048 + 풀해상도 타일), Log 자동 감지, CPU 소스 정규화(§3·§4), EXIF 추출·표시·재삽입 엔진(JPEG/PNG)
- Step 3: WebGL2 멀티패스 렌더러(사진 프록시·원본 타일, 비디오 실시간), Log CST, 원터치 마스터 레시피, /lab/renderer
- Step 4: 메인 편집 화면(/lab/renderer 승격), 저장 모달(원본/압축, 예상 용량), EXIF 재삽입 연결, Web Share, 비디오 내보내기, PWA(Service Worker 프리캐시)

## 11. 정직성 메모
- 후지필름·리코의 내부 이미지 처리 알고리즘은 비공개다. FSE-v2 의 LUT 색 파라미터·프리셋 수치·ISP 상수는 실기 측정값이 아니라 공개 특성 기반 설계값이며(UI 표기 "카메라 렌더링 근사", "실기 1:1"·"정품 재현" 표현 금지), 실기 SOOC 동일성은 docs/COLOR_SCIENCE.md §14 보정 프로토콜(실기 RAW+JPEG 쌍 측정)로 수렴시킨다.
- Samsung Log 는 공식 백서 수식을 내장한다(COLOR_SCIENCE §16.1). DJI D-Log M 은 공개 수식이 없어 D-Log 곡선 + D-Gamut 근사를 내장하고 UI 에 "근사" 를 표시한다(§16.2). 사용자가 공식 변환 LUT 를 등록하면 LUT 가 우선한다. 상수 추정 금지.

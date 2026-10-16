# MEDIA_PIPELINE.md — Step 2 통합 미디어 로더 + EXIF 100% 보존 엔진 명세

이 문서는 Step 2 프롬프트의 섹션 5~14 를 글자 그대로 옮긴 것이다. 섹션 번호는 원문을 따른다. 색 수식의 진실 원천은 docs/COLOR_SCIENCE.md (§3·§4)이며, 구현은 src/lib/color/source/*.mjs 한 곳에 둔다.

## 5. 파일 구조 (전부 생성)
- src/lib/media-loader.ts — 메인 스레드 파사드
- src/lib/exif-manager.ts — EXIF 파사드
- src/lib/media/
  types.ts, errors.ts, sniff.ts, budget.ts, binary.ts(DataView 헬퍼), jpeg.ts, tiff.ts, isobmff.ts, ebml.ts, riff.ts, png-chunks.ts, icc.ts, orientation.ts, resample.ts, image-decode.ts, heic.ts, raw-preview.ts, libraw-loader.ts, raw-decode.ts, video-probe.ts, video-frame.ts, histogram.ts, log-detect.ts, rpc.ts
- src/lib/exif/
  binstr.ts, extract.ts, summary.ts, display.ts, dict.ts, serialize.ts, insert-jpeg.ts, insert-png.ts, xmp.ts, iptc.ts, crc32.ts
- src/lib/color/source/
  primaries.mjs, transfer.mjs, normalize.mjs (JSDoc 타입, 외부 의존성 0)
- src/workers/media-decode.worker.ts
- src/app/lab/media/page.tsx
- scripts/vendor-assets.mjs
- tests/fixtures/exif-ii.jpg.b64 (섹션 15 픽스처)
- tests/*.test.ts (섹션 15)

## 6. 공통 타입 (src/lib/media/types.ts)
```ts
export type MediaKind = "raw" | "image" | "video";
export type SourceFormat = "jpeg" | "png" | "webp" | "heic" | "arw" | "dng" | "nef" | "raf" | "cr3" | "mp4" | "mov" | "webm";
export type SourceProfileId = "srgb-image" | "rec709" | "hlg" | "pq" | "slog3" | "slog2" | "flog" | "flog2" | "clog3" | "vlog" | "nlog" | "dlog" | "applelog" | "samsunglog" | "dlogm" | "raw-linear";
export type SourcePrimaries = "srgb" | "display-p3" | "adobe-rgb" | "rec2020" | "s-gamut3-cine" | "s-gamut3" | "cinema-gamut" | "v-gamut" | "d-gamut" | "f-gamut-c";
export interface SourceDescriptor { profile: SourceProfileId; primaries: SourcePrimaries; range: "full" | "limited"; bitDepth: number; rawScale: number | null; }
  (profile 은 전달함수를 결정한다. 이미지=srgb-image, Rec.709 비디오=rec709, RAW=raw-linear)
export interface PixelBufferF32 { width: number; height: number; data: Float32Array; }
  (RGBA 인터리브. 값은 "소스 인코딩 그대로"의 0~1 실수(RAW 는 선형 v/65535), 알파 1. 방향 보정 적용 후 표시 방향)
export interface VideoInfo { container: "mp4" | "mov" | "webm"; codec: string; codecFourcc: string; width: number; height: number; fps: number; durationSec: number; bitDepth: number; hasAudio: boolean; audioCodec: string | null; audioSampleRate: number | null; colour: { primaries: number | null; transfer: number | null; matrix: number | null; fullRange: boolean | null }; make: string | null; model: string | null; creationTime: string | null; bitrateBps: number; playback4k60: { supported: boolean; smooth: boolean; powerEfficient: boolean } | null; }
export interface LogDetection { profile: SourceProfileId; primaries: SourcePrimaries; confidence: "tag" | "metadata" | "filename" | "histogram-suggestion" | "default"; autoApply: boolean; candidates: SourceProfileId[]; evidence: string[]; requiresSourceLut: boolean; }
export interface HistogramStats { bins1024: Uint32Array; p0_1: number; p0_5: number; p50: number; p99_5: number; p99_9: number; logLike: boolean; sampleCount: number; }
export interface MediaAsset { id: string; kind: MediaKind; format: SourceFormat; fileName: string; byteSize: number; displaySize: { width: number; height: number }; orientation: number; descriptor: SourceDescriptor; proxy: PixelBufferF32; previewOnly: boolean; video: VideoInfo | null; detection: LogDetection | null; histogram: HistogramStats | null; exif: import("../exif/summary").ExifExtractionPublic | null; decodeStrategy: string; warnings: string[]; }
```

## 7. 포맷 판별 (sniff.ts) — 파일 앞 64KB 매직 바이트 기준, 확장자는 보조
1. 매직 바이트 규칙
   - FF D8 FF → jpeg
   - 89 50 4E 47 0D 0A 1A 0A → png
   - "RIFF" ???? "WEBP" → webp
   - "FUJIFILMCCD-RAW " (0 바이트부터 16자) → raf
   - 1A 45 DF A3 → webm
   - 바이트 4~7 = "ftyp"
     major/compatible 브랜드에 "crx " → cr3
     heic|heix|hevc|hevx|heim|heis|mif1|msf1 중 하나이고 crx 아님 → heic
     그 외 → 확장자 .mov 또는 브랜드 "qt  " 이면 mov, 아니면 mp4
   - "II*\0" 또는 "MM\0*" → TIFF 계열. 확장자 .arw → arw, .nef → nef, .dng → dng. IFD0 에 0xC612(DNGVersion)가 있으면 확장자와 무관하게 dng.
   - 첫 박스 타입이 moov|mdat|wide|free|skip 이고 확장자 .mov/.mp4 → 각각 mov/mp4
2. 그 외는 UNSUPPORTED_FORMAT("지원하지 않는 형식입니다: <확장자>"). 지원 확장자는 ARW, DNG, RAF, CR3, NEF, JPG, JPEG, PNG, WEBP, HEIC, MP4, MOV, WEBM 뿐이다.

## 8. 사진(JPEG/PNG/WEBP/HEIC) 디코드 (image-decode.ts, heic.ts, 워커)
### 8.1 공통 원칙
- 방향(Orientation)은 브라우저 자동 회전에 맡기지 않는다. 디코드 전에 EXIF 를 제거하고 섹션 10.2 매핑을 직접 적용한다. 브라우저마다 동작이 달라 생기는 이중 회전을 원천 차단하기 위해서다.
- 알파 채널은 버리고 A=1 로 둔다.

### 8.2 JPEG
1. jpeg.ts 의 segment 파서로 SOI 부터 SOS 직전까지 세그먼트를 읽는다.
   - 마커 FF xx, 연속 FF 패딩은 건너뛴다.
   - 길이 없는 마커: D0~D7, 01
   - 나머지는 u16 BE 길이(길이 필드 2바이트 포함)
2. APP1 세그먼트를 모두 제거한 사본 Blob 을 만든다. APP2(ICC)는 유지한다.
3. 크기(SOF0/1/2 의 W,H)로 메모리 판단(섹션 10.4) 후 디코드: createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "default" })
4. OffscreenCanvas 2D 에 그린 뒤 getImageData 로 RGBA8 을 얻는다(8.6 색공간 규칙).
5. 방향은 원본 EXIF Orientation(섹션 13 추출기)으로 적용한다.

### 8.3 PNG
- 비트 깊이 16: fast-png decode 로 원값을 보존한다.
  - channels 1/2 → R=G=B, 3/4 → RGB
  - v = val/65535
  - palette 는 convertIndexedToRgb 후 8bit 처리
  - 원색: iccEmbeddedProfile 이 있으면 profile 바이트를 icc.ts 로 분류(섹션 8.7), 실패하면 name 으로 분류, 없으면 srgb. 전달함수는 srgb-image.
- 비트 깊이 8 이하: 8.2 의 3~4 와 같은 브라우저 경로. eXIf 청크는 디코드 전 제거한다(png-chunks.ts).
- 방향: eXIf 의 Orientation 으로 적용한다.

### 8.4 WEBP
- riff.ts 로 "EXIF" 청크를 제거한 RIFF 를 다시 만든다.
  - RIFF 크기 = 4 + Σ(8 + 청크크기 + 패딩)
  - VP8X 청크가 있으면 flags 바이트(데이터 0번)의 0x08(EXIF) 비트를 끈다.
- 브라우저 경로로 디코드한다. 방향은 원본 EXIF 청크의 Orientation.

### 8.5 HEIC
1. 네이티브 우선: 워커에서 createImageBitmap(heicBlob) 을 시도한다. 성공하면 8.6 경로로 처리한다.
   HEIF 는 irot/imir 변환이 디코드 단계에서 적용되므로 Orientation 을 추가 적용하지 않는다(orientationApplied, orientation 은 1로 기록).
2. 실패(예외)하면 워커가 { type: "needs-main-heic" } 를 회신한다.
3. 메인 스레드: const { default: heic2any } = await import("heic2any"); const png = await heic2any({ blob, toType: "image/png" }); (배열이면 첫 요소)
   이 PNG 를 워커 op "heic-png" 로 transfer 한다.
4. 워커: fast-png decode(8bit) 로 원값을 읽는다. 원색은 heic.ts 가 원본 HEIC 의 ipco/colr 로 판정한다.
   - nclx: primaries 12 → display-p3, 1 → srgb, 9 → rec2020
   - prof/rICC: icc.ts 분류
   - 없으면 srgb
   - 전달함수 srgb-image, 방향 적용 안 함

### 8.6 브라우저 경로 색공간 규칙
- 워커 시작 시 1회 탐지
  const c = new OffscreenCanvas(1,1).getContext("2d", { colorSpace: "display-p3" });
  p3 = !!c && typeof (c as any).getContextAttributes === "function" && (c as any).getContextAttributes().colorSpace === "display-p3"
- p3=true: 캔버스 colorSpace "display-p3", getImageData(…, { colorSpace: "display-p3" }), descriptor.primaries = "display-p3"
- p3=false: "srgb", descriptor.primaries = "srgb"
- 브라우저가 내장 ICC(sRGB, P3, Adobe RGB 등)를 캔버스 공간으로 색 관리한다. 전달함수는 srgb-image. 8bit 값 v = byte/255.

### 8.7 ICC 분류 (icc.ts)
- 태그 테이블: 오프셋 128 에 u32 개수, 항목 12바이트(서명, 오프셋, 크기).
- "desc" 태그
  타입 "desc"(v2): +8 u32 길이, +12 ASCII
  타입 "mluc"(v4): +8 레코드수, +12 레코드크기, 첫 레코드 +20 길이, +24 오프셋 → UTF-16BE 문자열(태그 시작 기준)
- 소문자 비교로 분류: "p3" 포함 → display-p3, "srgb" → srgb, "adobe rgb" 또는 "adobergb" → adobe-rgb, "2020" → rec2020, 그 외 → srgb (경고 "알 수 없는 ICC: <설명>")

## 9. 카메라 RAW (ARW, DNG, RAF, CR3, NEF)
### 9.1 빠른 내장 프리뷰 (raw-preview.ts, 수 초 걸리는 현상 전에 즉시 표시)
1. 파일 전체 바이트에서 JPEG 후보를 스캔한다. p 를 0 부터 증가시키며 b[p]=FF, b[p+1]=D8, b[p+2]=FF 인 지점에서 파싱을 시도한다.
   a. q = p+2. 반복:
      - b[q] 는 FF 여야 한다. 연속 FF 는 건너뛰고 마커 m 을 읽는다.
      - m ∈ {D8, D9, D0~D7} 이면 실패.
      - len = u16BE(q+2), len ≥ 2, 범위 내여야 한다.
      - m ∈ {C0, C1, C2}: P=b[q+4], H=u16(q+5), W=u16(q+7), Nf=b[q+9]. P=8, W≥8, H≥8, Nf∈{1,3} 이어야 하고 기록한다.
      - m ∈ {C3, C5, C6, C7, C9, CA, CB, CD, CE, CF} 이면 실패(무손실·산술 = RAW 데이터 자체).
      - m = DA(SOS): SOF 기록이 없으면 실패. 엔트로피 데이터에서 FF 뒤가 00 도 D0~D7 도 아닌 첫 마커를 찾는다.
        D9 → 끝 = 그 위치+2, 후보 확정.
        그 외 마커 → 그 위치부터 세그먼트 파싱을 계속한다(프로그레시브).
      - 그 외 마커: q += 2 + len
   b. 성공하면 p = 끝 으로 점프, 실패하면 p+1. 후보는 최대 64개, 길이 ≥ 1024.
2. 선택: W×H 최대, 동률이면 오프셋이 작은 것.
3. 선택된 JPEG 에서 APP1 을 제거하고 createImageBitmap 으로 디코드한다.
   방향은 RAW 의 EXIF Orientation(섹션 13.2 추출기, TIFF 계열은 IFD0, CR3 는 CMT1, RAF 는 내장 JPEG)을 적용한다.
   결과 ImageBitmap 을 { type: "preview" } 로 즉시 메인에 transfer 한다(표시 전용 8bit, 편집 버퍼 아님).
4. 후보가 없으면 프리뷰 없이 진행 상태만 표시한다.

### 9.2 LibRaw 인스턴스 위치
- 워커 스코프에 typeof Worker === "function" 이면 워커 안에서 LibRaw 를 생성한다(중첩 워커).
- 아니면 워커가 { type: "needs-main-raw" } 를 회신한다. 메인이 libraw-loader 로 디코드한 뒤 결과 Uint16Array 를 op "raw-pixels" 로 transfer 하고, 이후 처리(9.4)는 워커에서 한다.

### 9.3 현상 설정 (프록시용, 정확히 이 키들만 지정하고 나머지는 패키지 기본값)
{ halfSize: true, useCameraWb: true, useAutoWb: false, useCameraMatrix: 1, outputColor: 1, outputBps: 16, gamm: [1, 1], noAutoBright: true, highlight: 0, userFlip: 0, userQual: 3, adjustMaximumThr: 0, expCorrec: false }
- 의미: 카메라 WB, 카메라→sRGB(Rec.709 원색, D65) 선형 행렬, 16bit 선형, 자동 밝기 없음, 하이라이트 클립, 회전 없음.
- 출력 v = d/65535 (센서 포화 = 1.0)
- K_raw = 2.04 × 2^BE, BE = metadata(true).color_data.dng_levels.baseline_exposure (유한수가 아니거나 DNG 가 아니면 0). descriptor = { profile:"raw-linear", primaries:"srgb", range:"full", bitDepth:16, rawScale:K_raw }
- 방향: metadata.flip 을 EXIF 로 매핑한다(0→1, 3→3, 5→8, 6→6, 그 외→1 + 경고).
  이 값이 9.1 에서 쓴 EXIF Orientation 과 다르면 flip 기준으로 통일하고 경고를 남긴다.
- 실패 처리
  - open/imageData 예외, WebAssembly.Memory 할당 실패 → previewOnly=true. 9.1 프리뷰 JPEG 를 8.2 경로로 디코드해 proxy 로 쓴다. 경고: "RAW 현상 실패 — 내장 프리뷰(JPEG)로 표시합니다"
  - NOT_CROSS_ORIGIN_ISOLATED 도 같은 폴백
- 사용 후 dispose() 를 반드시 호출한다(공유 메모리 해제).

### 9.4 RAW 프록시
- Uint16 RGB(colors=3) → Float32 RGBA(v, A=1)
- 방향 적용(10.2)
- 10.3 영역 평균으로 장축 ≤ 2048 (선형값이므로 전달함수 변환 없음)
- displaySize = metadata.width/height 에 방향을 반영한 원본 풀 크기

### 9.5 풀해상도 RAW (Step 4 저장용, 이번 단계는 API 만 구현)
- 같은 설정에 halfSize:false 로 디코드한다.
- 허용 조건: W×H×14 ≤ 예산(10.4). 초과하면 OUT_OF_MEMORY_BUDGET("기기 메모리 한도로 원본 해상도 현상이 불가합니다. 절반 해상도로 저장됩니다")
- 결과는 워커에 보관하고 dispose 시 해제한다.

## 10. 버퍼 관리
### 10.1 프록시와 풀해상도 분리
- 편집 미리보기는 항상 proxy(장축 ≤ 2048, Float32 RGBA)만 쓴다.
- 풀해상도는 getFullResolutionTile(assetId, rect) 로 필요할 때 타일 단위로만 만든다.
  - 이미지: 원본 Blob 을 createImageBitmap(blob, sx, sy, sw, sh, 옵션) 으로 크롭 디코드한다. 표시 좌표 rect 를 10.2 역매핑으로 원본 rect 로 바꾼 뒤 방향을 적용한다.
  - RAW: 9.5 버퍼에서 잘라낸다.
  - 타일 최대 2048×2048.
### 10.2 방향 매핑 (원본 W×H, 출력 W'×H', o∈{5,6,7,8} 이면 W'=H, H'=W)
- 출력 픽셀 (x', y') 의 원본 좌표
  1: (x', y')
  2: (W−1−x', y')
  3: (W−1−x', H−1−y')
  4: (x', H−1−y')
  5: (y', x')
  6: (y', H−1−x')
  7: (W−1−y', H−1−x')
  8: (W−1−y', x')
- 표시 rect(x, y, w, h) → 원본 rect
  1: (x, y, w, h)
  2: (W−x−w, y, w, h)
  3: (W−x−w, H−y−h, w, h)
  4: (x, H−y−h, w, h)
  5: (y, x, h, w)
  6: (y, H−x−w, h, w)
  7: (W−y−h, H−x−w, h, w)
  8: (W−y−h, x, h, w)
### 10.3 영역 평균 축소 (resample.ts)
- 목표 크기: L = max(W,H) ≤ 2048 이면 그대로. 아니면 s = 2048/L, 출력 w = round(W·s), h = round(H·s), 장축은 정확히 2048.
- 가로 가중치: sx = W/w, 출력 i 에 대해 입력 j 의 가중치 w_ij = max(0, min(j+1, (i+1)·sx) − max(j, i·sx)), out = Σ w_ij·in_j / sx. 세로도 같다.
- 스트리밍 구현: 입력 행을 순서대로 가로 축소한 뒤 세로 가중치로 출력 행에 누적한다. 추가 메모리는 출력 버퍼 + 1행뿐이다.
- srgb-image 소스는 평균 전 srgbDec, 평균 후 srgbEnc(실수 저장, 양자화 없음). raw-linear 는 그대로 평균한다.
### 10.4 메모리 예산 (budget.ts, 메인에서 계산해 워커에 전달)
- isIOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
- isAndroid = /Android/i.test(UA)
- budgetBytes = iOS 320·2^20, Android 448·2^20, 그 외 1024·2^20
- 이미지: 2×W×H×4 > budgetBytes/2 이면 축소 디코드. 장축 4096 으로 createImageBitmap(…, { resizeWidth, resizeHeight, resizeQuality: "high" }). 결과 크기가 요청과 다르면 OffscreenCanvas drawImage(imageSmoothingQuality "high") 로 축소한다. 그다음 10.3. decodeStrategy 에 "reduced-4096" 기록.
- 활성 자산 1개 규칙(CLAUDE.md §2-12).

## 11. 동영상 로드와 Log 감지
### 11.1 메타데이터 (video-probe.ts, Blob.slice 로 필요한 박스만 읽음, 전체 로드 금지)
- ISOBMFF(mp4/mov)
  - 최상위 박스 순회: 헤더 size u32 BE + type. size=1 이면 다음 u64, size=0 이면 파일 끝까지.
  - moov 크기 > 64MB 면 오류.
  - 컨테이너로 내려가는 박스: moov, trak, mdia, minf, stbl, udta, meta.
    meta 판별: payload[4..8)="hdlr" 이면 QuickTime 형식(그대로 자식 시작), payload[8..12)="hdlr" 이면 ISO FullBox(4바이트 건너뜀).
  - mvhd: v0 creation u32 / v1 u64 (1904-01-01 UTC 기준 초) → creationTime ISO 문자열
  - mdhd: v0 timescale(+12) duration(+16) u32 / v1 timescale(+20) duration(+24) u64
  - hdlr: +8 handler_type ("vide"/"soun")
  - stsd: FullBox + entry_count. 첫 샘플 엔트리 type = codecFourcc.
    VisualSampleEntry: 헤더 8 이후 +24 width u16, +26 height u16, 자식 박스는 엔트리 시작+86 부터.
    AudioSampleEntry: 헤더 8 이후 +24 samplerate 16.16
  - colr: "nclx" → primaries u16, transfer u16, matrix u16, (u8>>7)=full_range. "nclc" → 같은 3개, full_range=false.
  - stts: entry 중 sample_count 최대인 항목의 delta 로 fps = timescale/delta
  - stsz, stco/co64, stss: 첫 샘플 위치(11.3)
  - avcC: codec = "avc1." + hex2대문자(b[1]) + hex2(b[2]) + hex2(b[3]); bitDepth = b[1]∈{110,122,244} ? 10 : 8
  - hvcC (fourcc hvc1/hev1)
    b[1] = space(2b)|tier(1b)|profile_idc(5b), b[2..6) compat u32, b[6..12) 제약 6바이트, b[12] level_idc, bitDepth = (b[17] & 7) + 8
    codec = fourcc + "." + ["","A","B","C"][space] + profile_idc + "." + hex대문자(reverseBits32(compat)) + "." + (tier?"H":"L") + level_idc
    이어서 제약 바이트를 마지막 0이 아닌 바이트까지 "." + hex2대문자 로 붙인다.
  - 그 외 코덱(apch/apcn/apcs/apco/ap4h/ap4x ProRes, av01, vp09 등): codec = fourcc, bitDepth = ProRes 10, 그 외 8
  - make/model
    QuickTime keys/ilst: keys = FullBox, entry_count, (size u32, "mdta", 키 문자열). ilst 항목 type = 1부터 키 인덱스, 내부 "data" 박스(type u32, locale u32, 값 UTF-8).
    키 com.apple.quicktime.make, com.apple.quicktime.model, com.android.manufacturer, com.android.model
    udta "©mak"/"©mod": u16 길이, u16 언어, 문자열
  - bitrateBps = round(byteSize·8/durationSec)
- EBML(webm), 앞 4MB 만 읽음
  - ID: 첫 바이트 선행 비트로 길이 1~4, 마커 비트 포함 값
  - 크기 VINT 1~8바이트(마커 제거, 전부 1이면 미정 크기 = 부모 끝까지)
  - ID 표: Segment 18538067, Info 1549A966, TimecodeScale 2AD7B1, Duration 4489(float), Tracks 1654AE6B, TrackEntry AE, TrackType 83(1 비디오, 2 오디오), CodecID 86, DefaultDuration 23E383, Video E0, PixelWidth B0, PixelHeight BA, Colour 55B0, MatrixCoefficients 55B1, BitsPerChannel 55B2, Range 55B9(2=full), TransferCharacteristics 55BA, Primaries 55BB, Audio E1, SamplingFrequency B5, Cluster 1F43B675(도달 시 중단)
  - fps = 1e9/DefaultDuration, durationSec = Duration × TimecodeScale/1e9
- 4K60 판정: navigator.mediaCapabilities.decodingInfo({ type:"file", video:{ contentType:`video/mp4; codecs="${codec}"` (webm 은 video/webm), width, height, bitrate: bitrateBps, framerate: fps } }) → playback4k60 = { supported, smooth, powerEfficient }. API 가 없으면 null.

### 11.2 Log 감지 파이프라인 (log-detect.ts, 위에서부터 처음 확정된 단계 사용)
A. 태그
   - transfer 18 → hlg, 원색 rec2020, autoApply true
   - transfer 16 → pq. 오류 PQ_UNSUPPORTED("HDR10(PQ) 영상은 지원하지 않습니다")
B. 메타데이터 문자열
   - 모든 최상위 박스(mdat, free, skip, wide 제외, 각 최대 8MB)를 ASCII 소문자로 바꿔 검색한다.
   - Sony: /capturegammaequation\s+value\s*=\s*"([^"]+)"/ → g, /capturecolorprimaries\s+value\s*=\s*"([^"]+)"/ → p
     g 에 "s-log3" → slog3, "s-log2" → slog2, "hlg" → hlg, "rec709"·"itu709"·"s-cinetone" → rec709
     p 에 "s-gamut3-cine" 또는 "s-gamut3.cine" → s-gamut3-cine, 그 외 "s-gamut3" 또는 "s-gamut" → s-gamut3, "rec2020"·"itu2020" → rec2020, 없으면 프로파일 기본 원색
   - 일반 부분문자열 (우선순위 순): "apple log"|"applelog" → applelog, "f-log2" → flog2, "f-log" → flog, "d-log m"|"d-log-m"|"dlog-m"|"dlogm" → dlogm, "d-log" → dlog, "c-log3"|"canon log 3"|"clog3" → clog3, "v-log" → vlog, "n-log" → nlog, "samsung log" → samsunglog
   - autoApply true
C. 파일명
   - 정규화: 소문자, 확장자 제거, 공백·_·-·. 제거
   - 토큰 순서: slog3, slog2, applelog, flog2, flog, dlogm, dlog, clog3, vlog, nlog, samsunglog, hlg
   - vlog, dlog 는 일반 단어와 겹치므로 autoApply false(제안). 나머지는 autoApply true.
D. 히스토그램 제안 (11.3 통계, autoApply false)
   - logLike = p0_1 ≥ 0.025 && p99_9 ≤ 0.95 && 0.15 ≤ p50 ≤ 0.65
   - logLike 일 때 제조사(11.1 make, 없으면 메타 텍스트에서 samsung, apple, dji, sony, fujifilm, canon, panasonic, nikon 순 첫 일치)
     samsung→samsunglog, apple→applelog, dji→dlogm, sony→slog3, fujifilm→flog2, canon→clog3, panasonic→vlog, nikon→nlog
   - 제조사가 없으면 후보 = vBlack ≤ p0_1 + 0.01 인 프로파일을 vBlack 내림차순으로. 첫 후보를 제안한다.
E. 기본: rec709 (원색 srgb), confidence "default"
- 프로파일 표 (vBlack = 반사율 0 의 Full 확장 신호값, 기본 원색)
  slog3 0.0354 s-gamut3-cine | slog2 0.0300 s-gamut3 | flog 0.0354 rec2020 | flog2 0.0354 rec2020 | clog3 0.0731 cinema-gamut | vlog 0.0729 v-gamut | nlog 0.0722 rec2020 | dlog 0.0929 d-gamut | applelog 0.1505 rec2020 | hlg — rec2020 | samsunglog — LUT | dlogm — LUT
- samsunglog/dlogm 은 requiresSourceLut=true. src/lib/lut/lutStore 에 role "source-transform" 이고 sourceProfile 이 일치하는 LUT 가 없으면 경고 SOURCE_TRANSFORM_LUT_REQUIRED("공식 변환 LUT 등록이 필요합니다 — /lab/luts 에서 등록").
- range: nclx full_range 또는 WebM Range=2 면 "full", 그 외 "limited". bitDepth: 11.1 값.

### 11.3 첫 프레임과 히스토그램 (video-frame.ts, histogram.ts)
1. WebCodecs 경로 (워커, 코덱이 avc1/avc3/hvc1/hev1 이고 VideoDecoder 존재 시)
   - config = { codec, description: avcC 또는 hvcC 박스 페이로드(박스 헤더 8바이트 제외), codedWidth, codedHeight, hardwareAcceleration: "no-preference" }
   - isConfigSupported 가 false 면 2번 경로로 간다.
   - 첫 샘플: stss 가 있고 첫 항목 ≠ 1 이면 2번 경로. 오프셋 = stco[0] 또는 co64[0], 크기 = stsz.sample_size(0 이 아니면) 또는 첫 엔트리.
   - decode(new EncodedVideoChunk({ type:"key", timestamp:0, data })) → flush → VideoFrame
   - 형식 I420, I420P10, I420P12, I422, I422P10, I444, I444P10, NV12: copyTo 로 Y 평면(0번)을 읽는다.
     10/12bit 는 u16 LE. b = 비트수.
     limited: v = (Y − 16·2^(b−8))/(219·2^(b−8))
     full: v = Y/(2^b − 1)
     [0,1] 로 clamp
   - 형식 RGBA/RGBX/BGRA/BGRX: v = 0.2126R' + 0.7152G' + 0.0722B' (값/255)
   - 프록시(썸네일): createImageBitmap(frame) → OffscreenCanvas(srgb) 를 장축 ≤ 2048 로 그린 뒤 Float32 로 변환(v=byte/255)
   - frame.close(), decoder.close()
2. 폴백 (메인 스레드)
   - <video muted playsInline preload="auto"> + objectURL
   - loadeddata 를 최대 10초 대기, currentTime=0 이후 seeked
   - createImageBitmap(video) → 워커 op "video-frame-bitmap" 으로 transfer → 캔버스 RGB 로 v(휘도식) 계산
   - <video> 오류면 UNSUPPORTED_CODEC("이 기기 브라우저가 디코드할 수 없는 코덱입니다: <codec>")
3. 통계
   - 표본 간격 step = max(1, ceil(sqrt(W·H/1e6))) (가로·세로 모두)
   - 1024 빈: idx = min(1023, floor(v·1024))
   - 분위수 p_q = 누적 개수 ≥ q·N 인 첫 빈의 (idx+0.5)/1024 (q = 0.001, 0.005, 0.5, 0.995, 0.999)
4. 비디오 proxy 의 descriptor 는 감지 결과(사용자 전환 시 갱신)를 따른다. 썸네일 값은 브라우저 색 변환을 거친 8bit 이므로 정확한 YUV→RGB 정규화는 Step 4 셰이더가 담당한다(경고 문구로 표시).

## 12. CPU 소스 정규화 (src/lib/color/source/*.mjs) — COLOR_SCIENCE §3·§4 원문 구현
### 12.1 primaries.mjs
- 원색표: §3 + Adobe RGB
- RP177 유도: X_i = x_i/y_i, Y_i = 1, Z_i = (1−x_i−y_i)/y_i 로 P, W = [x_w/y_w, 1, (1−x_w−y_w)/y_w], S = P⁻¹W, M = P·diag(S)
- matrixToWS(primaries) = (M_709)⁻¹·M_src, 3×3 역행렬은 여인수 공식
### 12.2 골든 M_src→709 (±1e-6)
display-p3 [[1.224940,-0.224940,0],[-0.042057,1.042057,0],[-0.019638,-0.078636,1.098274]]
adobe-rgb [[1.398356,-0.398356,0],[0,1,0],[0,-0.042929,1.042929]]
rec2020 [[1.660491,-0.587641,-0.072850],[-0.124550,1.132900,-0.008349],[-0.018151,-0.100579,1.118730]]
s-gamut3-cine [[1.626947,-0.540139,-0.086809],[-0.178516,1.417941,-0.239425],[-0.044436,-0.195920,1.240356]]
s-gamut3 [[1.877915,-0.794169,-0.083746],[-0.176807,1.351000,-0.174193],[-0.026201,-0.148422,1.174623]]
cinema-gamut [[1.923861,-0.798761,-0.125101],[-0.204311,1.495899,-0.291588],[-0.023685,-0.420127,1.443812]]
v-gamut [[1.806576,-0.695697,-0.110879],[-0.170090,1.305955,-0.135865],[-0.025206,-0.154468,1.179674]]
d-gamut [[1.674723,-0.579789,-0.094934],[-0.098088,1.333984,-0.235896],[-0.040967,-0.242984,1.283951]]
f-gamut-c [[2.119851,-1.075705,-0.044146],[-0.230336,1.372442,-0.142106],[-0.014227,-0.150225,1.164452]]
M_709→XYZ = [[0.412391,0.357584,0.180481],[0.212639,0.715169,0.072192],[0.019331,0.119195,0.950532]]
### 12.3 transfer.mjs + normalize.mjs — toWorkingSpace(v[3], descriptor, sourceLut?) → WS 선형
1. 코드값: profile ∈ {slog3, slog2, flog, flog2, clog3, vlog, nlog} 이고 range="limited" 이면 y = (v·876+64)/1023, 그 외 y = v
2. 디코드 (채널별)
   - S-Log3: y ≥ 171.2102946929/1023 → 10^((1023y−420)/261.5)·0.19 − 0.01, 그 외 (1023y−95)·0.01125/(171.2102946929−95)
   - S-Log2: f=(1023y−64)/876; y ≥ 0.0882512925 → s=10^((f−0.646596)/0.432699)−0.037584, 그 외 s=(f−0.030001222851889303)/5; x=s·0.9·219/155
   - F-Log: cut2=0.100537775223865,a=0.555556,b=0.009468,c=0.344676,d=0.790453,e=8.735631,f=0.092864; y ≥ cut2 → (10^((y−d)/c)−b)/a, 그 외 (y−f)/e
   - F-Log2: 같은 식, cut2=0.100686685370811,a=5.555556,b=0.064829,c=0.245281,d=0.384316,e=8.799461,f=0.092864
   - C-Log3: y<0.097465473 → s=−(10^((0.12783901−y)/0.36726845)−1)/14.98325; y≤0.15277891 → s=(y−0.12512219)/1.9754798; 그 외 s=(10^((y−0.12240537)/0.36726845)−1)/14.98325; x=0.9s
   - V-Log: y<0.181 → (y−0.125)/5.6, 그 외 10^((y−0.598206)/0.241514)−0.00873
   - N-Log: y<0.4418377321603128 → (y/(650/1023))³−0.0075, 그 외 exp((y−619/1023)/(150/1023))
   - D-Log: y≤0.14 → (y−0.0929)/6.025, 그 외 (10^(3.89616y−2.27752)−0.0108)/0.9892
   - Apple Log: R0=−0.05641088, Rt=0.01, σ=47.28711236, β=0.00964052, γ=0.08550479, δ=0.69336945, Pt=σ(Rt−R0)²
     y≥Pt → 2^((y−δ)/γ)−β; 0≤y<Pt → sqrt(y/σ)+R0; y<0 → R0
   - HLG: a=0.17883277, b=0.28466892, c=0.55991073; y≤0.5 → E=y²/3, 그 외 E=(exp((y−c)/a)+b)/12; x = E·(0.18/0.0481333333)
   - srgb-image: x = toneInv(srgbDec(y)) (FSE engine.mjs 의 toneInv, T_ref=REF_TONE)
   - rec709: x = toneInv(y^2.4)
   - raw-linear: x = y·rawScale
   - samsunglog/dlogm: sourceLut 필수(없으면 SOURCE_TRANSFORM_LUT_REQUIRED 예외). tetraSample(sourceLut, y) → Rec.709 표시 신호 → rec709 경로
   - pq: PQ_UNSUPPORTED 예외
3. 원색 변환: WS = matrixToWS(descriptor.primaries)·x
### 12.4 골든 (상대 오차 1e-5 이내)
- 디코드 y = 0.2 / 0.5 / 0.8 → x
  slog3 0.0185131 / 0.415263 / 6.33266
  slog2 0.0479173 / 0.569689 / 3.93595
  flog 0.0178078 / 0.241533 / 1.9015
  flog2 0.0202332 / 0.521557 / 8.9008
  clog3 0.0376367 / 0.580777 / 4.14327
  vlog 0.0137196 / 0.383349 / 6.83886
  nlog 0.0236872 / 0.488377 / 3.77852
  dlog 0.0211764 / 0.462534 / 6.9734
  applelog 0.00862359 / 0.198914 / 2.36395
- HLG E(0.25)=0.0208333, E(0.5)=0.0833333, E(0.75)=0.264963
- toWorkingSpace
  srgb-image/srgb [0.5,0.5,0.5] → [0.201706 ×3]
  srgb-image/display-p3 [0.8,0.4,0.2] → [0.812779, 0.106375, 0.021095] (±2e-6)
  rec709/srgb [0.25,0.5,0.75] → [0.043525, 0.179522, 0.523848]
  slog3/s-gamut3-cine/limited [356/876 ×3] → [0.18 ×3]
  hlg/rec2020 [0.38 ×3] → [0.18 ×3]
  raw-linear/srgb rawScale 2.04 [0.5 ×3] → [1.02 ×3]

## 13. EXIF 엔진 (src/lib/exif/*, 파사드 src/lib/exif-manager.ts)
### 13.1 TIFF 리더 (src/lib/media/tiff.ts) — 원값 정확 보존
- 헤더: "II"(LE) 또는 "MM"(BE), u16 42, u32 IFD0 오프셋
- IFD: u16 개수(≤1000), 항목 12바이트(tag u16, type u16, count u32, 값 또는 오프셋 u32; 크기 ≤4 면 인라인, 좌측 정렬), 다음 IFD u32
- 타입 크기: 1:1, 2:1, 3:2, 4:4, 5:8, 6:1, 7:1, 8:2, 9:4, 10:8, 11:4, 12:8, 13:4
- 보호 장치: 오프셋 범위 검사, count×size ≤ 16MB, 방문 오프셋 집합으로 순환 차단
- 하위 IFD: IFD0 의 0x8769→Exif, 0x8825→GPS, Exif 의 0xA005→Interop, IFD0 다음 = IFD1
- 결과: Map<tag, RawEntry{ tag, type, count, bytes: Uint8Array(원본 바이트순서 그대로), littleEndian, valueOffsetPos: 항목 값 필드의 TIFF 내 위치 }>
### 13.2 형식별 추출 (extract.ts) → ExifPayload
ExifPayload = { mode: "tiff-bytes" | "tiff-dict"; tiff: Uint8Array | null; dict: { "0th", "Exif", "GPS", "Interop" } | null; xmp: Uint8Array | null; iptcIrb: Uint8Array | null; orientation: number; report: string[] }
- JPEG: APP1 "Exif\0\0" 첫 세그먼트 → tiff(접두 6바이트 뒤). 두 번째 이후는 report.
  APP1 "http://ns.adobe.com/xap/1.0/\0" → xmp. APP13 "Photoshop 3.0\0" → iptcIrb(페이로드 전체). mode "tiff-bytes"
- HEIC: 최상위 meta(FullBox)
  - iinf(v0: u16 개수 / v≥1: u32), infe v2: item_ID u16 / v3: u32, protection u16, item_type 4cc, 이름. "Exif" 항목과 item_type "mime" + content_type "application/rdf+xml" 항목(XMP).
  - iloc v0/1/2
    offset_size(4b) length_size(4b) base_offset_size(4b) index_size(4b, v1/2)
    item_count(v<2 u16, v2 u32)
    항목: item_ID(v2 u32, 그 외 u16), v1/2 면 12b 예약 + construction_method 4b(0만 지원), data_ref u16, base_offset, extent_count u16
    extent 마다 [index(v1/2 이고 index_size>0)], extent_offset, extent_length
  - Exif 페이로드: u32 BE 오프셋 n, tiff = payload[4+n:]. mode "tiff-bytes"
- PNG: eXIf 청크 → tiff ("Exif\0\0" 로 시작하면 6바이트 제거). iTXt 키워드 "XML:com.adobe.xmp" → xmp (압축 플래그 1 이면 DecompressionStream("deflate")). mode "tiff-bytes"
- WEBP: "EXIF" 청크 → tiff (같은 접두 규칙), "XMP " → xmp. mode "tiff-bytes"
- RAF: 헤더 오프셋 84 u32 BE = 내장 JPEG 오프셋, 88 u32 BE = 길이 → JPEG 규칙. mode "tiff-bytes"
- ARW/NEF/DNG: 파일 자체를 TIFF 리더로 읽어 dict 를 만든다. mode "tiff-dict"
  - "0th" 는 IFD0 화이트리스트만: 0x010E,0x010F,0x0110,0x0112,0x011A,0x011B,0x0128,0x0131,0x0132,0x013B,0x8298,0x9C9B,0x9C9C,0x9C9D,0x9C9E,0x9C9F,0x4746,0x4749
  - "Exif" 전체(0xA005 제외), "GPS" 전체, "Interop" 전체
  - IFD0 0x02BC → xmp, IFD0 0x83BB(IPTC) → iptcIrb 로 감싼다: "Photoshop 3.0\0" + "8BIM" + u16 0x0404 + 00 00 + u32 길이 + 데이터 + (홀수면 00)
- CR3: moov 안 uuid 85C0B687-820F-11E0-8111-F4CE462B6A48 의 자식 CMT1(IFD0 화이트리스트), CMT2(그 IFD0 = Exif 전체), CMT4(그 IFD0 = GPS 전체). CMT3 MakerNote 는 제외하고 report "CR3 MakerNote 는 오프셋 의존 구조라 제외". uuid BE7ACFCB-97A9-42E8-9C71-999491E3AFAC → xmp. mode "tiff-dict"
- orientation = IFD0 0x0112 값(없으면 1)
### 13.3 dict 값 변환 (dict.ts, piexif 입력 형식)
- 1 BYTE → number[]
- 2 ASCII → 원본 바이트를 binary string 으로(각 문자 = 1바이트, 0~255), 끝 NUL 정확히 1개 제거(piexif 가 다시 붙임). JS 유니코드 문자열 변환 금지.
- 3 SHORT, 4 LONG, 13 IFD → count 1 이면 number, 아니면 number[] (13은 "Long")
- 5 RATIONAL, 10 SRATIONAL → count 1 이면 [n,d], 아니면 [[n,d],…] (정수 그대로, 실수 변환 금지)
- 7 UNDEFINED → binary string
- 6, 8, 9, 11, 12 → "Undefined" 로 바꾸고 값을 빅엔디언 바이트로 재인코딩한다. report 에 "태그 0x…: 타입 N → UNDEFINED" 기록.
### 13.4 piexif 직렬화 (serialize.ts)
- 모듈 초기화 시 piexif.TAGS["0th"], ["Exif"], ["GPS"], ["Interop"] 의 원본을 깊은 복사로 보관한다.
- dump 직전: dict 에 있는 모든 (그룹, 태그)에 대해 TAGS[그룹][태그] = { name: 기존 이름 또는 "Tag0x" + hex4대문자, type: 13.3 타입명 } 으로 덮어쓴다. 이로써 OffsetTime(0x9010~0x9012) 같은 테이블 누락 태그와 소스와 다른 타입(예: UserComment)이 원본 타입 그대로 기록된다.
- dump 직후(finally): 원본 테이블로 복원한다.
- dict 의 "0th" 에서 0x8769, 0x8825 를, "Exif" 에서 0xA005 를 제거한다(piexif 가 포인터를 자동 생성).
- 결과 문자열은 "Exif\0\0" + MM(빅엔디언) TIFF 다.
### 13.5 저장용 보정 (두 모드 공통)
- Orientation = 1 (중복 회전 방지, 필수)
- PixelXDimension(0xA002)/PixelYDimension(0xA003) = 실제 출력 크기
  - tiff-bytes: IFD0 0x0112 가 있으면 valueOffsetPos 위치에 원본 바이트순서로 1을 쓴다(없으면 추가하지 않음, 기본값이 1). Exif 0xA002/0xA003 이 SHORT 면 ≤65535 일 때만, LONG 이면 그대로 제자리 기록한다. 그 외 바이트는 1비트도 바꾸지 않는다.
  - tiff-dict: dict["0th"][0x0112]=1(SHORT), dict.Exif[0xA002/0xA003]=출력 크기(LONG)
- XMP: tiff:Orientation="숫자" 와 <tiff:Orientation>숫자</tiff:Orientation> 를 1로, exif:PixelXDimension/PixelYDimension 같은 두 패턴을 출력 크기로 치환한다(정규식, UTF-8).
### 13.6 JPEG 삽입 (insert-jpeg.ts)
1. 출력 JPEG(캔버스 결과)의 SOS 이전 세그먼트에서 APP0(JFIF/JFXX), 모든 APP1, APP13 을 제거한다. APP2 ICC 는 유지한다.
2. TIFF 준비(13.5)
3. 크기 한도: 6 + tiff 길이 ≤ 65533
   - 초과 시 tiff-bytes 는 TIFF 리더로 dict 를 만들어 tiff-dict 로 전환한다.
   - dict 축소 순서: MakerNote(0x927C) 제거 → UserComment(0x9286) 제거 → count>1024 인 BYTE/UNDEFINED 태그를 태그번호 오름차순으로 제거. 각 단계 후 재측정하고 report 에 기록한다.
   - 그래도 초과하면 EXIF_TOO_LARGE
4. piexif.insert("Exif\0\0"+TIFF 의 binary string, 출력 JPEG binary string) → bytes
5. XMP 가 있으면 Exif APP1 바로 뒤에 APP1("http://ns.adobe.com/xap/1.0/\0" + XMP) 을 삽입한다. 65533 초과면 생략하고 report.
6. iptcIrb 가 있으면 그 뒤에 APP13 을 삽입한다(같은 한도).
7. 검증: 결과를 다시 파싱해 Orientation==1 을 단언한다. 실패하면 예외.
### 13.7 PNG 삽입 (insert-png.ts)
- 청크 파싱: 시그니처 8바이트, (len u32 BE, type, data, crc)
- 기존 eXIf, iTXt(XML:com.adobe.xmp) 를 제거한다.
- IHDR 바로 뒤에 eXIf(데이터 = TIFF, 접두 없음) 를 넣는다. 64KB 한도 없음.
- XMP 가 있으면 그 뒤에 iTXt 를 넣는다: "XML:com.adobe.xmp" 00 00 00 00 00 + XMP UTF-8
- CRC32 = 다항식 0xEDB88320, 초기값 0xFFFFFFFF, 최종 XOR 0xFFFFFFFF, 범위는 type+data
- IPTC 는 PNG 표준 위치가 없으므로 report "PNG 에는 IPTC 를 기록하지 않음"
### 13.8 표시용 추출 (summary.ts, display.ts) — exifr 사용
- 대상 TIFF: tiff-bytes 는 그 TIFF, tiff-dict 는 13.4 dump(보정 전 dict) 결과 TIFF. 저장될 내용 = 표시되는 내용.
- 요약용: exifr.parse(tiff, { tiff:true, ifd0:true, ifd1:false, exif:true, gps:true, interop:true, makerNote:false, userComment:false, xmp:false, icc:false, iptc:false, jfif:false, ihdr:false, translateKeys:false, translateValues:false, reviveValues:false, sanitize:false, mergeOutput:false, silentErrors:true }) → 숫자 태그 키
- 전체 보기용: exifr.parse(원본 파일 바이트(jpeg/heic/png/tiff 계열) 또는 TIFF(그 외), { tiff:true, ifd0:true, ifd1:true, exif:true, gps:true, interop:true, xmp:true, icc:true, iptc:true, makerNote:false, userComment:true, translateKeys:true, translateValues:true, reviveValues:true, mergeOutput:false, silentErrors:true })
- 요약 필드와 형식
  - 바디: Model 이 Make 로 시작하면(대소문자 무시) Model, 아니면 "Make Model" (공백 정리)
  - 렌즈: LensModel(0xA434), LensMake(0xA433) 가 있고 모델이 그것으로 시작하지 않으면 앞에 붙인다. 없으면 LibRaw lens.Lens, 그것도 없으면 "정보 없음"
  - 초점거리: FocalLength(0x920A) "Nmm"(소수 1자리, .0 제거). 35mm 환산(0xA405)이 있고 다르면 " (35mm 환산 Nmm)"
  - 조리개: FNumber(0x829D) "f/" + 소수 1자리(.0 제거)
  - 셔터: t=ExposureTime(0x829A)
    t ≥ 1 → "N초"(소수 1자리, .0 제거)
    t < 1 이고 |1/t − round(1/t)| < 0.05·(1/t) → "1/round(1/t)"
    그 외 "N초"
  - ISO: 0x8827 → "ISO N"
  - 노출보정: 0x9204 → 0이면 "0 EV", 아니면 부호(+ 또는 −) + 절댓값 소수 1자리(.0 제거) + " EV"
  - 촬영일시: 0x9003 → 0x9004 → 0x0132 → LibRaw timestamp → file.lastModified("(파일 수정 시각)" 표기) 순으로 첫 값. "YYYY.MM.DD HH:MM:SS", OffsetTimeOriginal(0x9011)이 있으면 공백 뒤에 덧붙인다.
  - 색공간: ICC 설명(exifr icc)이 있으면 그것, 없으면 0xA001 1→"sRGB", 0xFFFF→"Uncalibrated"
  - GPS: 위도 = (d + m/60 + s/3600)·(Ref "S" → −1), 경도 동일(Ref "W" → −1). 소수 6자리 + N/S/E/W. 고도 = 값·(Ref 1 → −1) "N.Nm". 0x0002 가 없으면 "위치 정보 없음"
  - 소프트웨어 0x0131, 작가 0x013B, 저작권 0x8298
  - 원본 크기(방향 반영), 파일 크기, 형식
- 전체 보기: 그룹(ifd0, exif, gps, interop, ifd1, iptc, icc, xmp) × (키, 값)
  - Date → "YYYY.MM.DD HH:MM:SS"
  - 배열 → ", " 결합
  - Uint8Array → 앞 32바이트 hex + " (총 N바이트)"
  - xmp → 앞 2000자
### 13.9 파사드 API (src/lib/exif-manager.ts)
```ts
export async function extractExif(bytes: Uint8Array, format: SourceFormat, rawMeta?: unknown): Promise<ExifExtraction>   // { summary, groups, payload }
export function insertExifIntoJpeg(outJpeg: Uint8Array, payload: ExifPayload, outSize: {width:number;height:number}): { bytes: Uint8Array; report: string[] }
export function insertExifIntoPng(outPng: Uint8Array, payload: ExifPayload, outSize: {width:number;height:number}): { bytes: Uint8Array; report: string[] }
export function formatSummaryRows(summary: ExifSummary): Array<{ label: string; value: string }>
```
- 표시 라벨 순서: 바디, 렌즈, 초점거리, 조리개, 셔터, ISO, 노출보정, 촬영일시, 색공간, GPS, 고도, 소프트웨어, 작가, 저작권, 원본 크기, 파일 크기, 형식

## 14. 메인 파사드와 워커 프로토콜
### 14.1 src/lib/media-loader.ts
```ts
export type LoadStage = "sniff" | "metadata" | "preview" | "decode" | "proxy" | "analyze" | "done";
export interface LoadCallbacks { onPreview?(p: { bitmap: ImageBitmap; width: number; height: number }): void; onProgress?(stage: LoadStage, message: string): void; }
export async function loadMedia(file: File, cb?: LoadCallbacks): Promise<MediaAsset>
export async function getFullResolutionTile(assetId: string, rect: { x: number; y: number; width: number; height: number }): Promise<PixelBufferF32>
export async function setSourceProfile(assetId: string, profile: SourceProfileId, primaries?: SourcePrimaries): Promise<MediaAsset>
export async function renderOriginalPreview(assetId: string, maxLongEdge: number): Promise<ImageBitmap>
export function disposeMedia(assetId: string): void
```
- renderOriginalPreview: 워커에서 proxy 의 각 픽셀을 toWorkingSpace 로 바꾸고 채널별 srgbEnc(clamp(tone(x, T_ref), 0, 1)) 로 8bit 화해 ImageBitmap 을 만든다(검증 화면 전용).
- 워커 1개를 지연 생성한다(new Worker(new URL("../workers/media-decode.worker.ts", import.meta.url), { type: "module" })).
- loadMedia 는 이전 자산을 dispose 한 뒤 시작한다.
### 14.2 메시지
- 요청 { id, op, … }
  op ∈ "load", "heic-png", "raw-pixels", "video-frame-bitmap", "tile", "set-profile", "render-original", "dispose"
- 응답
  { id, type: "progress", stage, message }
  { id, type: "preview", bitmap, width, height }
  { id, type: "needs-main-heic" | "needs-main-raw" | "needs-main-video-frame", …필요 데이터 }
  { id, type: "result", asset }
  { id, type: "error", code, message }
- 큰 버퍼(proxy.data.buffer, ImageBitmap, Uint16Array.buffer)는 transferable 로만 보낸다.
### 14.3 오류 코드 (errors.ts, 한국어 메시지 + 해결 방법)
UNSUPPORTED_FORMAT, UNSUPPORTED_CODEC, DECODE_FAILED, OUT_OF_MEMORY_BUDGET, NOT_CROSS_ORIGIN_ISOLATED, PQ_UNSUPPORTED, SOURCE_TRANSFORM_LUT_REQUIRED, EXIF_PARSE_FAILED, EXIF_TOO_LARGE
경고: RAW_PREVIEW_ONLY, REDUCED_DECODE, ORIENTATION_MISMATCH

---

## 구현 노트 (원문 아님 — 구현과 명세의 대응·해석 기록)
- 9.4 displaySize: LibRaw 의 metadata.width/height 는 flip≥5 일 때 이미 가로·세로가 바뀐 값이고 imageData 픽셀은 userFlip:0 이라 회전 전이다. 픽셀 가로세로와 어긋나면 되돌려 "회전 전 풀 크기"를 만든 뒤 10.2 방향을 반영한다.
- 8.5 displaySize: ispe 는 irot 적용 전 크기이므로 irot 이 홀수 회전이면 가로세로를 바꿔 표시 크기로 쓴다(방향은 1).
- 14.2 후속 op(tile, set-profile, render-original)의 응답은 type "tile-result" / "profile-result" / "render-result" 로 구분한다. 실패한 render-original 은 transfer 중이던 proxy 버퍼를 error 응답에 실어 돌려준다.
- 13.2 ExifPayload 에 dictTypes(그룹·태그별 piexif 타입명)를 추가했다. 13.4 의 "type: 13.3 타입명" 덮어쓰기에 필요한 값이다.
- CPU 대량 경로(toWorkingSpaceBuffer)는 srgb-image/rec709 의 Tref⁻¹ 를 16384칸 테이블(노드는 §4.11 이분법 정확값)로 선형 보간한다. 표시 전용(renderOriginalPreview)이며, 단일 점 toWorkingSpace 는 이분법 48회 원문 구현이다.

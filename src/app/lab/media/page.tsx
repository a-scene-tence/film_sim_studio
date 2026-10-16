"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { extractExif, formatSummaryRows, insertExifIntoJpeg, insertExifIntoPng, type ExifGroupView } from "@/lib/exif-manager";
import {
  PROFILE_TABLE, SUPPORTED_EXTENSIONS, disposeMedia, getBudget, loadMedia, renderOriginalPreview, setSourceProfile,
  type LoadStage, type MediaAsset, type SourceProfileId,
} from "@/lib/media-loader";

const ACCEPT = ".arw,.dng,.raf,.cr3,.nef,.jpg,.jpeg,.png,.webp,.heic,.mp4,.mov,.webm";
const PROFILE_LABEL: Record<SourceProfileId, string> = {
  "srgb-image": "sRGB 이미지", rec709: "Rec.709", hlg: "HLG", pq: "PQ", slog3: "S-Log3", slog2: "S-Log2", flog: "F-Log", flog2: "F-Log2", clog3: "C-Log3",
  vlog: "V-Log", nlog: "N-Log", dlog: "D-Log", applelog: "Apple Log", samsunglog: "Samsung Log", dlogm: "D-Log M", "raw-linear": "RAW 선형",
};
const CONF_LABEL = { tag: "컨테이너 태그", metadata: "메타데이터", filename: "파일명", "histogram-suggestion": "히스토그램 제안", default: "기본값" } as const;
const STAGE_LABEL: Record<LoadStage, string> = { sniff: "형식 판별", metadata: "메타데이터", preview: "프리뷰", decode: "디코드", proxy: "프록시", analyze: "분석", done: "완료" };
const INTENTIONAL = new Set(["Orientation", "ExifImageWidth", "ExifImageHeight", "PixelXDimension", "PixelYDimension"]);
const INTENTIONAL_SUMMARY = new Set(["원본 크기", "파일 크기", "형식"]);

interface StageRow { stage: LoadStage; message: string; ms: number }
interface Out { kind: "jpeg" | "png"; url: string; name: string; size: number; rows: CompareRow[]; report: string[]; counts: { same: number; diff: number; intended: number } }
interface CompareRow { label: string; before: string; after: string; status: "일치" | "불일치" | "의도적 변경" }

const card = "rounded-2xl bg-neutral-900 p-4";
const btn = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-neutral-800 px-4 py-2 text-sm font-medium active:bg-neutral-700 disabled:opacity-40";

function mb(n: number) { return `${Math.round(n / 2 ** 20)}MB`; }

function flatten(groups: ExifGroupView[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const g of groups) if (["ifd0", "exif", "gps", "interop"].includes(g.id)) for (const r of g.rows) m.set(`${g.label}.${r.key}`, r.value);
  return m;
}

export default function MediaLab() {
  const [env, setEnv] = useState<{ coi: boolean; budget: string; p3: boolean } | null>(null);
  const [asset, setAsset] = useState<MediaAsset | null>(null);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [outs, setOuts] = useState<Out[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const histRef = useRef<HTMLCanvasElement>(null);
  const assetRef = useRef<string | null>(null);
  const outsRef = useRef<Out[]>([]);

  useEffect(() => {
    const b = getBudget();
    let p3 = false;
    try {
      const c = document.createElement("canvas").getContext("2d", { colorSpace: "display-p3" }) as { getContextAttributes?: () => { colorSpace?: string } } | null;
      p3 = !!c && c.getContextAttributes?.().colorSpace === "display-p3";
    } catch { /* 미지원 */ }
    setEnv({ coi: globalThis.crossOriginIsolated === true, budget: `${mb(b.budgetBytes)} (${b.isIOS ? "iOS" : b.isAndroid ? "Android" : "기타"})`, p3 });
  }, []);

  const draw = useCallback((bmp: ImageBitmap) => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext("2d")?.drawImage(bmp, 0, 0);
  }, []);

  const clearOuts = useCallback(() => {
    outsRef.current.forEach((o) => URL.revokeObjectURL(o.url));
    outsRef.current = [];
    setOuts([]);
  }, []);

  const show = useCallback(async (a: MediaAsset) => {
    try {
      const bmp = await renderOriginalPreview(a.id, 1024);
      if (assetRef.current === a.id) draw(bmp);
      bmp.close();
    } catch (e) {
      setErrors((x) => [...x, e instanceof Error ? e.message : String(e)]);
    }
  }, [draw]);

  const onFile = useCallback(async (file: File) => {
    if (assetRef.current) disposeMedia(assetRef.current);
    assetRef.current = null;
    setAsset(null); setStages([]); setErrors([]); clearOuts(); setBusy(true);
    const t0 = performance.now();
    let last = t0;
    const rows: StageRow[] = [];
    const mark = (stage: LoadStage, message: string) => {
      const now = performance.now();
      if (rows.length) rows[rows.length - 1]!.ms = Math.round(now - last);
      last = now;
      rows.push({ stage, message, ms: 0 });
      setStages(rows.map((r) => ({ ...r })));
    };
    try {
      const a = await loadMedia(file, {
        onProgress: mark,
        onPreview: ({ bitmap }) => { draw(bitmap); bitmap.close(); },
      });
      assetRef.current = a.id;
      setAsset(a);
      if (rows.length) rows[rows.length - 1]!.ms = Math.round(performance.now() - last);
      setStages(rows.map((r) => ({ ...r })));
      await show(a);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
    } finally {
      setBusy(false);
    }
  }, [clearOuts, draw, show]);

  useEffect(() => () => { if (assetRef.current) disposeMedia(assetRef.current); outsRef.current.forEach((o) => URL.revokeObjectURL(o.url)); }, []);

  // 히스토그램 (256막대 = 1024빈 4개씩 합산, 256×80)
  useEffect(() => {
    const c = histRef.current;
    const h = asset?.histogram;
    if (!c || !h) return;
    const g = c.getContext("2d");
    if (!g) return;
    const sums = new Array<number>(256).fill(0);
    for (let i = 0; i < 1024; i++) sums[i >> 2]! += h.bins1024[i]!;
    const max = Math.max(1, ...sums);
    g.clearRect(0, 0, 256, 80);
    g.fillStyle = "#e5e5e5";
    sums.forEach((s, i) => { const bh = Math.round((s / max) * 80); g.fillRect(i, 80 - bh, 1, bh); });
  }, [asset]);

  const switchProfile = async (p: SourceProfileId) => {
    if (!asset) return;
    setBusy(true);
    try {
      const next = await setSourceProfile(asset.id, p);
      setAsset(next);
      await show(next);
    } catch (e) {
      setErrors((x) => [...x, e instanceof Error ? e.message : String(e)]);
    } finally { setBusy(false); }
  };

  const reinsert = async (kind: "jpeg" | "png") => {
    if (!asset?.exif) return;
    setBusy(true);
    try {
      const bmp = await renderOriginalPreview(asset.id, 2048);
      const oc = new OffscreenCanvas(bmp.width, bmp.height);
      oc.getContext("2d")!.drawImage(bmp, 0, 0);
      const size = { width: bmp.width, height: bmp.height };
      bmp.close();
      const blob = await oc.convertToBlob(kind === "jpeg" ? { type: "image/jpeg", quality: 0.92 } : { type: "image/png" });
      const raw = new Uint8Array(await blob.arrayBuffer());
      const res = kind === "jpeg" ? insertExifIntoJpeg(raw, asset.exif.payload, size) : insertExifIntoPng(raw, asset.exif.payload, size);
      const back = await extractExif(res.bytes, kind, { byteSize: res.bytes.length, displaySize: size });
      const rows: CompareRow[] = [];
      const A = formatSummaryRows(asset.exif.summary), B = formatSummaryRows(back.summary);
      A.forEach((r, i) => {
        const after = B[i]!.value;
        rows.push({ label: r.label, before: r.value, after, status: INTENTIONAL_SUMMARY.has(r.label) ? "의도적 변경" : r.value === after ? "일치" : "불일치" });
      });
      const fa = flatten(asset.exif.groups), fb = flatten(back.groups);
      for (const [k, v] of fa) {
        const after = fb.get(k) ?? "—";
        const key = k.split(".").pop() ?? k;
        const status: CompareRow["status"] = INTENTIONAL.has(key) ? "의도적 변경" : v === after ? "일치" : "불일치";
        rows.push({ label: k, before: v, after, status });
      }
      const counts = { same: 0, diff: 0, intended: 0 };
      rows.forEach((r) => { if (r.status === "일치") counts.same++; else if (r.status === "불일치") counts.diff++; else counts.intended++; });
      const url = URL.createObjectURL(new Blob([res.bytes as BlobPart], { type: kind === "jpeg" ? "image/jpeg" : "image/png" }));
      const out: Out = { kind, url, name: `exif-test.${kind === "jpeg" ? "jpg" : "png"}`, size: res.bytes.length, rows, report: res.report, counts };
      outsRef.current = [...outsRef.current.filter((o) => o.kind !== kind), out];
      setOuts([...outsRef.current]);
    } catch (e) {
      setErrors((x) => [...x, e instanceof Error ? e.message : String(e)]);
    } finally { setBusy(false); }
  };

  const v = asset?.video;
  const det = asset?.detection;
  const candidates: SourceProfileId[] = det ? Array.from(new Set<SourceProfileId>([det.profile, ...det.candidates, "rec709", "hlg", ...PROFILE_TABLE.map((p) => p.id)])) : [];

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">미디어 로더 검증</h1>
        <Link href="/lab/luts" className={btn}>LUT 실험실</Link>
      </div>

      <section className={card} aria-label="환경">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-neutral-400">crossOriginIsolated</dt>
          <dd className={env?.coi ? "text-emerald-400" : "text-amber-400"}>{env ? String(env.coi) : "…"}</dd>
          <dt className="text-neutral-400">메모리 예산</dt><dd>{env?.budget ?? "…"}</dd>
          <dt className="text-neutral-400">P3 캔버스</dt><dd>{env ? (env.p3 ? "지원" : "미지원 (sRGB)") : "…"}</dd>
        </dl>
        {env && !env.coi && <p className="mt-2 text-xs text-amber-400">교차 출처 격리가 아니면 RAW 는 내장 프리뷰 전용으로 열립니다. HTTPS 배포 주소나 npm run dev 로 접속하세요.</p>}
      </section>

      <label className={`${btn} cursor-pointer`}>
        파일 선택 (사진 · RAW · 동영상)
        <input type="file" accept={ACCEPT} className="sr-only" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
      </label>
      <p className="text-xs text-neutral-500">지원: {SUPPORTED_EXTENSIONS}</p>

      {stages.length > 0 && (
        <section className={card} aria-label="진행 단계">
          <ol className="space-y-1 text-sm">
            {stages.map((s, i) => (
              <li key={i} className="flex justify-between gap-2"><span>{STAGE_LABEL[s.stage]}{s.message !== STAGE_LABEL[s.stage] && <span className="text-neutral-500"> · {s.message}</span>}</span><span className="tabular-nums text-neutral-400">{s.ms} ms</span></li>
            ))}
          </ol>
          {busy && <p className="mt-2 text-xs text-neutral-400">처리 중…</p>}
        </section>
      )}

      <canvas ref={canvasRef} className={`w-full rounded-2xl bg-neutral-900 ${stages.length ? "" : "hidden"}`} />

      {asset && (
        <section className={card} aria-label="자산 정보">
          <p className="text-sm">{asset.fileName} · {asset.format.toUpperCase()} · {asset.kind} · {asset.displaySize.width}×{asset.displaySize.height}</p>
          <p className="text-xs text-neutral-400">디코드 전략 {asset.decodeStrategy} · 방향 {asset.orientation} · 소스 {PROFILE_LABEL[asset.descriptor.profile]}/{asset.descriptor.primaries}{asset.descriptor.rawScale !== null ? ` · K_raw ${asset.descriptor.rawScale.toFixed(4)}` : ""}{asset.previewOnly ? " · 프리뷰 전용" : ""}</p>
        </section>
      )}

      {asset?.exif && (
        <section className={card} aria-label="EXIF 요약">
          <h2 className="mb-2 text-base font-semibold">EXIF 요약</h2>
          <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-sm">
            {formatSummaryRows(asset.exif.summary).map((r) => (<div key={r.label} className="contents"><dt className="text-neutral-400">{r.label}</dt><dd className="break-words">{r.value}</dd></div>))}
          </dl>
          <details className="mt-3">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm text-neutral-300">전체 태그 보기</summary>
            {asset.exif.groups.map((g) => (
              <div key={g.id} className="mt-2">
                <h3 className="text-xs font-semibold uppercase text-neutral-400">{g.label}</h3>
                <dl className="grid grid-cols-[9rem_1fr] gap-x-2 text-xs">
                  {g.rows.map((r) => (<div key={r.key} className="contents"><dt className="break-words text-neutral-500">{r.key}</dt><dd className="break-words">{r.value}</dd></div>))}
                </dl>
              </div>
            ))}
          </details>
        </section>
      )}

      {v && det && (
        <section className={card} aria-label="동영상 정보">
          <h2 className="mb-2 text-base font-semibold">동영상</h2>
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-sm">
            {([
              ["컨테이너", v.container], ["코덱", `${v.codec} (${v.codecFourcc})`], ["해상도", `${v.width}×${v.height}`], ["프레임률", `${v.fps.toFixed(3)} fps`],
              ["길이", `${v.durationSec.toFixed(2)}초`], ["비트 깊이", `${v.bitDepth}bit`], ["비트레이트", `${(v.bitrateBps / 1e6).toFixed(1)} Mbps`],
              ["오디오", v.hasAudio ? `${v.audioCodec} ${v.audioSampleRate ?? ""}Hz` : "없음"],
              ["색 태그", `primaries ${v.colour.primaries ?? "-"} / transfer ${v.colour.transfer ?? "-"} / matrix ${v.colour.matrix ?? "-"} / ${v.colour.fullRange === null ? "범위 불명" : v.colour.fullRange ? "Full" : "Limited"}`],
              ["제조사/모델", `${v.make ?? "-"} / ${v.model ?? "-"}`], ["촬영 시각", v.creationTime ?? "-"],
              ["4K60 재생", v.playback4k60 ? `${v.playback4k60.supported ? "지원" : "미지원"} · ${v.playback4k60.smooth ? "부드러움" : "끊김 가능"} · ${v.playback4k60.powerEfficient ? "저전력" : "고전력"}` : "판정 불가 (API 없음)"],
            ] as Array<[string, string]>).map(([k, val]) => (<div key={k} className="contents"><dt className="text-neutral-400">{k}</dt><dd className="break-words">{val}</dd></div>))}
          </dl>
          <canvas ref={histRef} width={256} height={80} className="mt-3 w-full rounded-lg bg-neutral-950" aria-label="휘도 히스토그램" />
          {asset?.histogram && <p className="mt-1 text-xs text-neutral-400">p0.1 {asset.histogram.p0_1.toFixed(3)} · p50 {asset.histogram.p50.toFixed(3)} · p99.9 {asset.histogram.p99_9.toFixed(3)} · 로그형 {asset.histogram.logLike ? "예" : "아니오"}</p>}
          <div className="mt-3 rounded-xl bg-neutral-800 p-3 text-sm">
            <p className="font-medium">{PROFILE_LABEL[det.profile]} <span className="text-neutral-400">· {CONF_LABEL[det.confidence]}{det.autoApply ? " · 자동 적용" : " · 제안"}</span></p>
            <p className="text-xs text-neutral-400">현재 적용: {PROFILE_LABEL[asset.descriptor.profile]} / {asset.descriptor.primaries} / {asset.descriptor.range}</p>
            <ul className="mt-1 list-disc pl-4 text-xs text-neutral-300">{det.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {candidates.map((p) => (
              <button key={p} type="button" disabled={busy || p === "pq"} onClick={() => void switchProfile(p)}
                className={`${btn} ${asset?.descriptor.profile === p ? "ring-2 ring-emerald-500" : ""}`}>{PROFILE_LABEL[p]}</button>
            ))}
          </div>
          {(asset?.descriptor.profile === "samsunglog" || asset?.descriptor.profile === "dlogm") && (
            <Link href="/lab/luts" className={`${btn} mt-3`}>공식 변환 LUT 등록(선택) → /lab/luts</Link>
          )}
        </section>
      )}

      {asset?.exif && (
        <section className={card} aria-label="EXIF 재삽입 테스트">
          <h2 className="mb-2 text-base font-semibold">EXIF 재삽입 테스트</h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={busy} onClick={() => void reinsert("jpeg")}>JPEG 로 재삽입</button>
            <button type="button" className={btn} disabled={busy} onClick={() => void reinsert("png")}>PNG 로 재삽입</button>
          </div>
          {outs.map((o) => (
            <div key={o.kind} className="mt-4">
              <p className="text-sm">{o.kind.toUpperCase()} · {(o.size / 1024).toFixed(1)} KB · 일치 {o.counts.same} / 불일치 <span className={o.counts.diff ? "text-amber-400" : ""}>{o.counts.diff}</span> / 의도적 변경 {o.counts.intended}</p>
              <a href={o.url} download={o.name} className={`${btn} mt-2`}>{o.name} 다운로드</a>
              {o.report.length > 0 && <ul className="mt-2 list-disc pl-4 text-xs text-neutral-400">{o.report.map((r, i) => <li key={i}>{r}</li>)}</ul>}
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-neutral-400"><tr><th className="py-1 pr-2">항목</th><th className="pr-2">원본</th><th className="pr-2">결과</th><th>판정</th></tr></thead>
                  <tbody>
                    {o.rows.map((r, i) => (
                      <tr key={i} className="border-t border-neutral-800 align-top">
                        <td className="py-1 pr-2">{r.label}</td><td className="break-all pr-2">{r.before}</td><td className="break-all pr-2">{r.after}</td>
                        <td className={r.status === "일치" ? "text-emerald-400" : r.status === "불일치" ? "text-amber-400" : "text-sky-400"}>{r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>
      )}

      {(errors.length > 0 || (asset?.warnings.length ?? 0) > 0) && (
        <section className={card} aria-label="경고와 오류">
          <ul className="space-y-1 text-sm">
            {errors.map((e, i) => <li key={`e${i}`} className="text-red-400">오류: {e}</li>)}
            {asset?.warnings.map((w, i) => <li key={`w${i}`} className="text-amber-400">경고: {w}</li>)}
          </ul>
        </section>
      )}
    </main>
  );
}

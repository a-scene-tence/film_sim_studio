"use client";
// Step 4 §10~§11 저장 모달: 사진(원본 화질 / 용량 압축 + 예상 용량) · 동영상(해상도·형식·fps·예상 용량), 진행·취소, 완료 카드
import { useEffect, useRef, useState } from "react";
import { fmtBytes } from "@/lib/export/estimate";
import { defaultPhotoOptions, estimatePhoto, exportPhoto, HOPELESS_MSG, MEMORY_MSG, planPhoto, type ExportJob, type ExportProgress, type PhotoExportOptions } from "@/lib/export/photo-export";
import { outSize } from "@/lib/export/out-size";
import { ExportCancelled, ExportClient } from "@/lib/export/worker-client";
import { fpsLine, MSG_ORIGINAL_TOO_LARGE, MSG_RECORDER, MSG_VIDEO_TOO_LONG, progressLine } from "@/lib/export/video-plan";
import type { VideoPlanInfo, VideoSizeChoice } from "@/lib/export/video-export";
import type { MediaAsset } from "@/lib/media-loader";
import type { RenderParams } from "@/lib/render/params";
import type { FilmRenderer } from "@/lib/render/renderer";
import { BottomSheet } from "./BottomSheet";
import { ExportResult, type ExportDone } from "./ExportResult";
import type { ToastFn } from "./Toast";

export interface ExportModalProps {
  open: boolean;
  onClose(): void;
  asset: MediaAsset | null;
  file: File | null;
  simId: string | null;
  renderer: FilmRenderer | null;
  params: RenderParams;
  /** 편집 상태 서명 (예상 용량 프록시 렌더 캐시 키) */
  editKey: string;
  toast: ToastFn;
  onRunningChange(running: boolean): void;
}

type Phase = "options" | "running" | "done";
const chipCls = (on: boolean, disabled?: boolean) =>
  `flex min-h-11 flex-1 flex-col items-center justify-center rounded-[10px] border px-2 text-[13px] ${on ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--line)] text-[var(--text)]"} ${disabled ? "opacity-40" : ""}`;

function Segment({ items, value, onChange }: { items: Array<[string, string]>; value: string; onChange(v: string): void }) {
  return (
    <div role="tablist" className="flex h-11 overflow-hidden rounded-[10px] border border-[var(--line)]">
      {items.map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id} className="flex-1 text-[14px]" style={value === id ? { background: "var(--panel-2)", color: "var(--accent)", fontWeight: 700 } : { color: "var(--text-2)" }} onClick={() => onChange(id)}>{label}</button>
      ))}
    </div>
  );
}

export function ExportModal(p: ExportModalProps) {
  const { open, asset, file, renderer, params, editKey, toast, onRunningChange } = p;
  const isVideo = asset?.kind === "video";
  const [phase, setPhase] = useState<Phase>("options");
  const [opts, setOpts] = useState<PhotoExportOptions>(defaultPhotoOptions);
  const [est, setEst] = useState<{ key: string; bytes: number } | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [vprog, setVprog] = useState<{ p: number; elapsed: number } | null>(null);
  const [done, setDone] = useState<ExportDone | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ id: string; info: VideoPlanInfo | null; err: string | null } | null>(null);
  const [vsize, setVsize] = useState<VideoSizeChoice>("original");
  const client = useRef<ExportClient | null>(null);
  const job = useRef<ExportJob>({ cancelled: false });
  const snapshot = useRef<{ key: string; snap: { width: number; height: number; data: Uint8ClampedArray } } | null>(null);
  const assetId = asset?.id ?? null;

  const getClient = () => (client.current ??= new ExportClient());
  useEffect(() => () => { client.current?.dispose(); client.current = null; }, []);

  // 모달이 열릴 때마다 옵션 화면으로 (이전 결과 해제)
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => { setPhase("options"); setDone(null); setError(null); setProgress(null); setVprog(null); setEst(null); });
    snapshot.current = null;
    job.current = { cancelled: false };
  }, [open, assetId]);

  // 동영상 계획 (코덱·오디오·예상 용량)
  useEffect(() => {
    if (!open || !isVideo || !file || !assetId) return;
    let alive = true;
    void import("@/lib/export/video-export").then((m) => m.planVideo(file)).then(
      (info) => { if (alive) { setPlan({ id: assetId, info, err: null }); setVsize(info.original.tooLarge && info.p1080 ? "1080p" : "original"); } },
      (e: unknown) => { if (alive) setPlan({ id: assetId, info: null, err: e instanceof Error ? e.message : String(e) }); },
    );
    return () => { alive = false; };
  }, [open, isVideo, file, assetId]);

  // 사진 예상 용량: 300ms 디바운스, 프록시를 RGBA8 로 한 번 렌더해 캐시
  const optsKey = `${editKey}|${JSON.stringify(opts)}`;
  useEffect(() => {
    if (!open || isVideo || !asset || !renderer || phase !== "options") return;
    let alive = true;
    const t = setTimeout(() => {
      void (async () => {
        try {
          if (!snapshot.current || snapshot.current.key !== editKey) snapshot.current = { key: editKey, snap: renderer.snapshotPreview() };
          const bytes = await estimatePhoto(getClient(), renderer, asset, opts, snapshot.current.snap);
          if (alive) setEst({ key: optsKey, bytes });
        } catch (e) {
          if (alive && !(e instanceof ExportCancelled)) setError(e instanceof Error ? e.message : String(e));
        }
      })();
    }, 300);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isVideo, asset, renderer, phase, optsKey]);

  if (!asset || !file) return <BottomSheet open={false} onClose={p.onClose}>{null}</BottomSheet>;

  const W = asset.displaySize.width, H = asset.displaySize.height;
  const calculating = !isVideo && (est === null || est.key !== optsKey);
  const estBytes = est && !calculating ? est.bytes : null;
  const photoPlan = !isVideo ? planPhoto(asset, opts, estBytes ?? 0) : null;
  const sizes = {
    full: { w: W, h: H }, p4096: outSize(W, H, 4096), p2048: outSize(W, H, 2048),
  };
  const long = Math.max(W, H);

  const finish = (d: ExportDone) => { setDone(d); setPhase("done"); onRunningChange(false); };
  const fail = (e: unknown) => {
    onRunningChange(false);
    setPhase("options");
    if (e instanceof ExportCancelled) { toast("저장을 취소했습니다"); return; }
    setError(e instanceof Error ? e.message : String(e));
  };
  const cancel = () => {
    job.current.cancelled = true;
    client.current?.cancel();
  };

  const startPhoto = async () => {
    if (!renderer) return;
    setError(null);
    job.current = { cancelled: false };
    setPhase("running");
    onRunningChange(true);
    setProgress({ value: 0, phase: "render", tile: 0, tiles: 1 });
    try {
      const r = await exportPhoto({ renderer, client: getClient(), asset, simId: p.simId, options: opts, job: job.current, start: new Date(), onProgress: setProgress });
      finish({ file: r.file, blob: r.blob, width: r.width, height: r.height, isVideo: false, warnings: [] });
    } catch (e) { fail(e); }
  };

  const startVideo = async () => {
    const info = plan?.info;
    if (!info) return;
    const variant = vsize === "1080p" && info.p1080 ? info.p1080 : info.original;
    setError(null);
    job.current = { cancelled: false };
    setPhase("running");
    onRunningChange(true);
    const t0 = performance.now();
    setVprog({ p: 0, elapsed: 0 });
    try {
      const { exportVideo } = await import("@/lib/export/video-export");
      const r = await exportVideo({
        file, asset, params, variant, plan: info, simId: p.simId, job: job.current, start: new Date(),
        onProgress: (pr) => setVprog({ p: pr, elapsed: (performance.now() - t0) / 1000 }),
      });
      finish({ file: r.file, blob: r.blob, width: r.width, height: r.height, isVideo: true, warnings: r.warnings });
    } catch (e) { fail(e); }
  };

  const running = phase === "running";
  let body: React.ReactNode;
  if (phase === "done" && done) {
    body = <ExportResult done={done} onClose={p.onClose} toast={toast} />;
  } else if (running) {
    const ph = progress;
    body = (
      <div className="flex flex-col gap-4 py-4">
        {isVideo ? (
          <>
            <p className="tnum text-[15px]">{progressLine(vprog?.p ?? 0, vprog?.elapsed ?? 0)}</p>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--line)]"><div className="h-full bg-[var(--accent)]" style={{ width: `${Math.round((vprog?.p ?? 0) * 100)}%` }} /></div>
            {plan?.info?.original.pick.container === "recorder" || (vsize === "1080p" ? plan?.info?.p1080 : plan?.info?.original)?.pick.container === "recorder" ? <p className="text-[12px] text-[var(--text-2)]">{MSG_RECORDER}</p> : null}
            <p className="text-[12px] text-[var(--text-2)]">저장 중에는 앱을 닫거나 화면을 끄지 마세요</p>
          </>
        ) : (
          <>
            <p className="tnum text-[15px]">{ph?.phase === "render" ? `렌더링 ${ph.tile}/${ph.tiles} 타일` : ph?.phase === "encode" ? "인코딩 중" : "EXIF 기록 중"}</p>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--line)]"><div className="h-full bg-[var(--accent)]" style={{ width: `${Math.round((ph?.value ?? 0) * 100)}%` }} /></div>
          </>
        )}
        <button type="button" className="h-12 rounded-[12px] border border-[var(--line)] text-[15px]" onClick={cancel}>취소</button>
      </div>
    );
  } else if (isVideo) {
    const info = plan?.info ?? null;
    const variant = info ? (vsize === "1080p" && info.p1080 ? info.p1080 : info.original) : null;
    const bothTooLarge = info ? info.original.tooLarge && (info.p1080 ? info.p1080.tooLarge : true) : false;
    const noEncoder = variant?.pick.container === "none";
    body = (
      <div className="flex flex-col gap-3 pt-1">
        {plan?.err ? <p className="text-[13px] text-[var(--danger)]">{plan.err}</p> : null}
        {!info && !plan?.err ? <p className="text-[13px] text-[var(--text-2)]">계산 중</p> : null}
        {info ? (
          <>
            <div className="flex gap-2">
              <button type="button" className={chipCls(vsize === "original", info.original.tooLarge)} disabled={info.original.tooLarge} aria-pressed={vsize === "original"} onClick={() => setVsize("original")}>
                <span>원본</span><span className="tnum text-[11px] text-[var(--text-2)]">{info.original.width}×{info.original.height}</span>
              </button>
              {info.p1080 ? (
                <button type="button" className={chipCls(vsize === "1080p")} aria-pressed={vsize === "1080p"} onClick={() => setVsize("1080p")}>
                  <span>1080p</span><span className="tnum text-[11px] text-[var(--text-2)]">{info.p1080.width}×{info.p1080.height}</span>
                </button>
              ) : null}
            </div>
            {info.original.tooLarge && !bothTooLarge ? <p className="text-[12px] text-[var(--accent)]">{MSG_ORIGINAL_TOO_LARGE}</p> : null}
            {bothTooLarge ? <p className="text-[12px] text-[var(--accent)]">{MSG_VIDEO_TOO_LONG}</p> : null}
            {noEncoder ? <p className="text-[12px] text-[var(--danger)]">이 기기는 동영상 인코딩을 지원하지 않습니다</p> : null}
            {variant ? (
              <dl className="grid grid-cols-[72px_1fr] gap-y-1.5 text-[13px]">
                <dt className="text-[var(--text-2)]">형식</dt><dd>{variant.line}</dd>
                <dt className="text-[var(--text-2)]">프레임</dt><dd className="tnum">{fpsLine(info.srcFps, info.fpsOut)}</dd>
                <dt className="text-[var(--text-2)]">예상 용량</dt><dd className="tnum">{fmtBytes(variant.estBytes)}</dd>
              </dl>
            ) : null}
            {variant?.audio.warning ? <p className="text-[12px] text-[var(--accent)]">{variant.audio.warning}</p> : null}
            {variant?.pick.container === "recorder" ? <p className="text-[12px] text-[var(--text-2)]">{MSG_RECORDER}</p> : null}
            <p className="text-[12px] text-[var(--text-2)]">저장 중에는 앱을 닫거나 화면을 끄지 마세요</p>
            <button type="button" disabled={bothTooLarge || noEncoder || !variant} className="h-12 rounded-[12px] bg-[var(--accent)] text-[15px] font-semibold text-[#0b0b0c] disabled:opacity-40" onClick={() => void startVideo()}>저장 시작</button>
          </>
        ) : null}
        {error ? <p className="text-[13px] text-[var(--danger)]">{error}</p> : null}
      </div>
    );
  } else {
    const startDisabled = !photoPlan?.fits || calculating || !renderer;
    body = (
      <div className="flex flex-col gap-3 pt-1">
        <Segment items={[["original", "원본 화질"], ["compress", "용량 압축"]]} value={opts.mode} onChange={(v) => setOpts((o) => ({ ...o, mode: v as PhotoExportOptions["mode"] }))} />
        {opts.mode === "original" ? (
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="형식">
            {([["jpeg", "JPEG 최고화질 · 품질 100 · 4:4:4"], ["png", "PNG 무손실 · 8비트"]] as const).map(([f, label]) => (
              <button key={f} type="button" role="radio" aria-checked={opts.format === f} className="flex min-h-11 items-center gap-3 text-left text-[14px]" onClick={() => setOpts((o) => ({ ...o, format: f }))}>
                <span className="flex h-5 w-5 items-center justify-center rounded-full border-2" style={{ borderColor: opts.format === f ? "var(--accent)" : "var(--text-2)" }}>{opts.format === f ? <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" /> : null}</span>
                {label}
              </button>
            ))}
            <p className="tnum text-[13px] text-[var(--text-2)]">해상도 100% · {W} × {H}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              {([["full", "100%", sizes.full.w, sizes.full.h, false], ["4096", "4096px", sizes.p4096.width, sizes.p4096.height, long <= 4096], ["2048", "2048px", sizes.p2048.width, sizes.p2048.height, long <= 2048]] as const).map(([id, label, w, h, dis]) => {
                const val = id === "full" ? "full" : (Number(id) as 4096 | 2048);
                return (
                  <button key={id} type="button" disabled={dis} aria-pressed={opts.size === val} className={chipCls(opts.size === val, dis)} onClick={() => setOpts((o) => ({ ...o, size: val }))}>
                    <span>{label}</span><span className="tnum text-[11px] text-[var(--text-2)]">{dis ? "원본 이하" : `${w}×${h}`}</span>
                  </button>
                );
              })}
            </div>
            <label className="flex flex-col gap-1 text-[13px]">
              <span className="flex justify-between"><span>화질</span><span className="tnum text-[var(--text-2)]">{opts.quality}%</span></span>
              <input type="range" min={60} max={98} step={1} value={opts.quality} aria-label="화질" className="h-11 w-full accent-[#ff6a1a]" onChange={(e) => setOpts((o) => ({ ...o, quality: Number(e.target.value), format: "jpeg" }))} />
            </label>
          </div>
        )}
        <p className="tnum text-[14px]">예상 용량 <span className="text-[var(--accent)]">{calculating ? "계산 중" : fmtBytes(estBytes ?? 0)}</span></p>
        <p className="text-[12px] text-[var(--text-2)]">EXIF 메타데이터 전체 유지 · 방향(Orientation)=1 로 저장</p>
        {photoPlan && !photoPlan.fits ? <p className="text-[12px] text-[var(--accent)]">{photoPlan.hopeless ? HOPELESS_MSG : MEMORY_MSG}</p> : null}
        {error ? <p className="text-[13px] text-[var(--danger)]">{error}</p> : null}
        <button type="button" disabled={startDisabled} className="h-12 rounded-[12px] bg-[var(--accent)] text-[15px] font-semibold text-[#0b0b0c] disabled:opacity-40" onClick={() => void startPhoto()}>저장 시작</button>
      </div>
    );
  }
  return <BottomSheet open={open} onClose={() => { if (!running) p.onClose(); }} title="저장하기" locked={running}>{body}</BottomSheet>;
}

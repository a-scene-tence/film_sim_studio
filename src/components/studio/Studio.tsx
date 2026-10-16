"use client";
// Step 4 §7 모바일 다크룸 스튜디오: 헤더 / 프리뷰 / 탭 패널 / 탭 바. 상태는 useReducer + Context 하나.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { loadMedia, PROFILE_TABLE, setSourceProfile, type MediaAsset, type SourceProfileId } from "@/lib/media-loader";
import { PROFILE_LABEL } from "@/lib/render/binding";
import { loadManifest } from "@/lib/render/luts";
import { FilmRenderer } from "@/lib/render/renderer";
import { RenderError } from "@/lib/render/gl";
import { OUTPUT_SPACE_KEY, parseOutputSpace, type OutputSpace } from "@/lib/render/output-space";
import { isoFromSummary } from "@/lib/render/params";
import { filmBadgeLabel } from "@/lib/export/frame";
import { computeAutoLight } from "@/lib/studio/auto-light";
import { autoProfile, badgeText, type InputChoice } from "@/lib/studio/input-profile";
import { editReducer, getValue, initialEditState, selectSim, type ParamKey, type SimInfo, type TabId } from "@/lib/studio/state";
import { startThumbnails } from "@/lib/studio/thumbs";
import { buildRenderParams } from "@/lib/studio/uniforms";
import { simRecipe } from "@/lib/studio/state";
import { registerServiceWorker } from "@/lib/pwa/register-sw";
import { lsGet, lsSet, nextInstallHint, OFFLINE_READY_KEY, OFFLINE_READY_TEXT, type BeforeInstallPromptEvent } from "@/lib/pwa/install-hints";
import { EmptyState } from "./EmptyState";
import { ExifInspector } from "./ExifInspector";
import { ExportModal } from "./ExportModal";
import { ACCEPT_FALLBACK, Header } from "./Header";
import { Preview } from "./Preview";
import { ProfileSheet } from "./ProfileSheet";
import { StudioContext, type StudioCtx } from "./StudioContext";
import { TabBar } from "./TabBar";
import { ColorTab } from "./tabs/ColorTab";
import { CurveTab } from "./tabs/CurveTab";
import { DetailTab } from "./tabs/DetailTab";
import { FilmTab } from "./tabs/FilmTab";
import { LightTab } from "./tabs/LightTab";
import { ToastView, useToastQueue } from "./Toast";

const DEMO_URL = "/demo/demo-scene.jpg";
const LIGHT_KEYS: ParamKey[] = ["lightBalance", "exposure", "brightness", "contrast", "highlights", "shadows", "whites", "blacks"];

/** 로더 단계 문구 끝의 말줄임표를 없앤다 */
const stripEllipsis = (s: string) => s.replace(/(…|\.{2,})\s*$/u, "");

export default function Studio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderer, setRenderer] = useState<FilmRenderer | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [ctxLost, setCtxLost] = useState(false);
  const [state, dispatch] = useReducer(editReducer, undefined, initialEditState);
  const [sims, setSims] = useState<SimInfo[]>([]);
  const [asset, setAsset] = useState<MediaAsset | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("film");
  const [choice, setChoice] = useState<InputChoice>("auto");
  const [profileOpen, setProfileOpen] = useState(false);
  const [exifOpen, setExifOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [compare, setCompare] = useState(false);
  const [outSpace, setOutSpace] = useState<OutputSpace>("srgb");
  const [p3Ok, setP3Ok] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [, setStatusTick] = useState(0);
  const [pauseSignal, setPauseSignal] = useState(0);
  const { current: toastItem, toast, dismiss } = useToastQueue();
  const fileInput = useRef<HTMLInputElement>(null);
  const installPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const hintShown = useRef(false);
  const pendingUpdate = useRef<(() => void) | null>(null);
  const exportingRef = useRef(false);
  const loadSeq = useRef(0);
  const iso = useMemo(() => isoFromSummary(asset?.exif?.summary.iso), [asset]);

  // ── 전역: 문서 스크롤 잠금, iOS 핀치 확대 방지 ────────────────────────────
  useEffect(() => {
    document.documentElement.classList.add("studio");
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", stop, { passive: false });
    document.addEventListener("gesturechange", stop, { passive: false });
    return () => {
      document.documentElement.classList.remove("studio");
      document.removeEventListener("gesturestart", stop);
      document.removeEventListener("gesturechange", stop);
    };
  }, []);

  // ── 렌더러 ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    let r: FilmRenderer;
    try {
      r = FilmRenderer.create(c);
    } catch (e) {
      queueMicrotask(() => setFatal(e instanceof RenderError && e.code === "UNSUPPORTED_WEBGL2" ? "이 브라우저는 WebGL2 를 지원하지 않아 사용할 수 없습니다" : e instanceof Error ? e.message : String(e)));
      return;
    }
    r.onStatus = () => setStatusTick((n) => n + 1);
    r.onError = (e) => toast(e.message);
    const lost = () => setCtxLost(true);
    const restored = () => setCtxLost(false);
    c.addEventListener("webglcontextlost", lost);
    c.addEventListener("webglcontextrestored", restored);
    queueMicrotask(() => {
      setRenderer(r);
      // Step 5 §3: P3 를 쓸 수 있는 기기에서만 전환 UI 를 보이고, 저장된 선택(기본 sRGB)을 복원한다
      const ok = r.supportsP3();
      setP3Ok(ok);
      if (ok) { const saved = parseOutputSpace(lsGet(OUTPUT_SPACE_KEY)); r.setOutputSpace(saved); setOutSpace(r.getOutputSpace()); }
    });
    return () => {
      c.removeEventListener("webglcontextlost", lost);
      c.removeEventListener("webglcontextrestored", restored);
      r.dispose();
      setRenderer(null);
    };
  }, [toast]);

  useEffect(() => {
    let alive = true;
    loadManifest().then((m) => {
      if (alive) setSims([...m.sims].sort((a, b) => a.order - b.order).map((s): SimInfo => ({ id: s.id, ko: s.ko, en: s.en, brand: s.brand, mono: s.mono })));
    }).catch((e: unknown) => toast(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [toast]);

  // ── 렌더 파라미터 (길게 눌러 원본 비교 = 필름 없음 + 모든 값 기본) ───────────
  const params = useMemo(() => buildRenderParams(compare ? initialEditState() : state, { iso }), [state, compare, iso]);
  useEffect(() => {
    if (renderer && asset) renderer.setParams(params);
  }, [renderer, asset, params]);

  const changeOutSpace = useCallback((s: OutputSpace) => {
    if (!renderer) return;
    renderer.setOutputSpace(s);
    const eff = renderer.getOutputSpace();
    setOutSpace(eff);
    lsSet(OUTPUT_SPACE_KEY, eff);
    toast(eff === "display-p3" ? "화면 출력: Display P3 (저장 파일은 sRGB)" : "화면 출력: sRGB");
  }, [renderer, toast]);

  const frameLabel = useMemo(() => filmBadgeLabel(state.simId === null ? null : (sims.find((x) => x.id === state.simId) ?? null), state.hdf), [state.simId, state.hdf, sims]);
  const mono = simRecipe(state.simId, sims).mono;

  // ── 미디어 열기 ──────────────────────────────────────────────────────────
  const openFile = useCallback(async (f: File, demo = false) => {
    if (!renderer) return;
    const seq = ++loadSeq.current;
    setLoading("파일 확인 중");
    try {
      const a = await loadMedia(f, { onProgress: (_s, m) => setLoading(stripEllipsis(m)) });
      if (seq !== loadSeq.current) return;
      if (a.kind === "video") {
        setLoading("영상 준비 중");
        await renderer.setVideoSource(a, f);
      } else renderer.setPhotoSource(a);
      const photoIso = isoFromSummary(a.exif?.summary.iso);
      setAsset(a);
      setFile(f);
      setIsDemo(demo);
      setChoice("auto");
      setThumbs({});
      setCompare(false);
      const base = selectSim(initialEditState(), demo ? "fuji-classic-chrome" : state.simId, photoIso);
      dispatch({ type: "replace", state: demo ? { ...base, hdf: true } : base });
      if (demo) toast("데모 사진입니다. 32종 필름 · HDF · 그레인 · 커브를 자유롭게 바꿔 보세요");
      else if (a.warnings.length > 0) toast(a.warnings[0]!);
      if (!hintShown.current) {
        hintShown.current = true;
        const hint = nextInstallHint(installPrompt.current);
        if (hint) toast(hint.text, hint.action ? { actions: [{ label: hint.action.label, onClick: hint.action.run }] } : undefined);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === loadSeq.current) setLoading(null);
    }
  }, [renderer, state.simId, toast]);

  const openDemo = useCallback(async () => {
    setLoading("데모 사진 불러오는 중");
    try {
      const res = await fetch(DEMO_URL);
      if (!res.ok) throw new Error(`데모 사진을 불러오지 못했습니다 (HTTP ${res.status}) — 네트워크 연결을 확인하고 다시 시도하세요`);
      const blob = await res.blob();
      await openFile(new File([blob], "demo-scene.jpg", { type: "image/jpeg", lastModified: Date.parse("2026-10-16T06:39:00+09:00") }), true);
    } catch (e) {
      setLoading(null);
      toast(e instanceof Error ? e.message : String(e));
    }
  }, [openFile, toast]);

  // ── 썸네일 ───────────────────────────────────────────────────────────────
  const thumbsKey = asset && sims.length > 0 ? asset.id : null;
  const baseForThumbs = useRef(state);
  useEffect(() => { baseForThumbs.current = state; }, [state]);
  useEffect(() => {
    if (!asset || !thumbsKey) return;
    return startThumbnails({
      asset, base: baseForThumbs.current, iso, simIds: [null, ...sims.map((s) => s.id)],
      onThumb: (id, url) => setThumbs((t) => ({ ...t, [id]: url })),
    });
    // 미디어가 바뀔 때만 다시 만든다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbsKey]);

  // ── PWA ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); installPrompt.current = e as BeforeInstallPromptEvent; };
    window.addEventListener("beforeinstallprompt", onPrompt);
    registerServiceWorker({
      onOfflineReady: () => {
        if (lsGet(OFFLINE_READY_KEY) === null) { toast(OFFLINE_READY_TEXT); lsSet(OFFLINE_READY_KEY, "1"); }
      },
      onUpdateReady: (apply) => {
        const show = () => toast("새 버전이 준비되었습니다", { actions: [{ label: "업데이트", onClick: apply }, { label: "나중에", onClick: () => undefined }] });
        if (exportingRef.current) pendingUpdate.current = show; else show();
      },
    });
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, [toast]);

  const onExportRunning = useCallback((running: boolean) => {
    exportingRef.current = running;
    setExporting(running);
    if (!running && pendingUpdate.current) { const f = pendingUpdate.current; pendingUpdate.current = null; f(); }
  }, []);

  // ── 입력 색공간 ──────────────────────────────────────────────────────────
  const selectProfile = useCallback(async (c: InputChoice) => {
    if (!asset || !renderer) return;
    try {
      const det = asset.detection;
      const prof: SourceProfileId = c === "auto" ? autoProfile(det, asset.kind !== "video") : c;
      const prim = c === "auto" ? (det?.autoApply ? det.primaries : undefined) : prof === "rec709" || prof === "srgb-image" ? undefined : PROFILE_TABLE.find((x) => x.id === prof)?.primaries;
      const next = await setSourceProfile(asset.id, prof, prim);
      renderer.updateAsset(next);
      setAsset(next);
      setChoice(c);
      setProfileOpen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  }, [asset, renderer, toast]);

  // ── 자동 보정 ────────────────────────────────────────────────────────────
  const runAuto = useCallback(() => {
    if (!renderer || !asset) return;
    try {
      const prev = Object.fromEntries(LIGHT_KEYS.map((k) => [k, getValue(state, k)])) as Partial<Record<ParamKey, number>>;
      const r = computeAutoLight(renderer.readAnalysisLuma());
      dispatch({ type: "patch", values: { exposure: r.exposure, contrast: r.contrast, highlights: r.highlights, shadows: r.shadows, whites: r.whites, blacks: r.blacks, brightness: 0, lightBalance: 0 } });
      toast("자동 보정 적용", { duration: 5000, actions: [{ label: "되돌리기", onClick: () => dispatch({ type: "patch", values: prev }) }] });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  }, [renderer, asset, state, toast]);

  const editKey = useMemo(() => JSON.stringify([state, compare, asset?.descriptor ?? null]), [state, compare, asset]);

  const ctx: StudioCtx = useMemo(
    () => ({ state, dispatch, sims, iso, asset, file, renderer, toast, mono, thumbs, hasMedia: asset !== null }),
    [state, sims, iso, asset, file, renderer, toast, mono, thumbs],
  );

  const binding = renderer?.inputBinding() ?? null;
  const isRaw = asset?.kind === "raw";
  const badge = asset ? badgeText({ isRaw, auto: choice === "auto", binding, fallback: asset.descriptor ? PROFILE_LABEL[asset.descriptor.profile] : "" }) : null;

  if (fatal) {
    return (
      <div className="fixed inset-0 flex items-center justify-center px-8 text-center" style={{ background: "var(--bg)" }}>
        <p className="text-[16px] leading-relaxed text-[var(--text)]">{fatal}</p>
      </div>
    );
  }

  return (
    <StudioContext.Provider value={ctx}>
      <div className="fixed inset-0 flex flex-col text-[var(--text)]" style={{ height: "100dvh", background: "var(--bg)", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>
        <Header
          onFile={(f) => void openFile(f)} accept={ACCEPT_FALLBACK} badge={badge} badgeDisabled={isRaw} approximate={binding?.approximate ?? false}
          onBadge={() => setProfileOpen(true)} demo={isDemo} onExif={() => setExifOpen(true)} onSave={() => { setPauseSignal((n) => n + 1); setExportOpen(true); }}
          hasMedia={asset !== null} busy={loading !== null || exporting}
          p3Available={p3Ok} outSpace={outSpace} onOutSpace={changeOutSpace}
        />
        <div className="studio-body">
          <Preview
            canvasRef={canvasRef} renderer={renderer} asset={asset} hdf={state.hdf} onToggleHdf={() => dispatch({ type: "toggleHdf" })}
            compare={compare} onCompare={setCompare} editKey={editKey} disabled={!asset || loading !== null} pauseVideoSignal={pauseSignal}
          >
            {!asset && !loading ? <EmptyState busy={!renderer} onOpen={() => fileInput.current?.click()} onDemo={() => void openDemo()} /> : null}
            {loading ? (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3" style={{ background: "rgba(0,0,0,0.6)" }} role="status" aria-live="polite">
                <span className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--accent)]" />
                <span className="text-[14px]">{loading}</span>
              </div>
            ) : null}
            {ctxLost ? (
              <div className="absolute inset-0 z-30 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }} role="status">
                <span className="text-[14px]">그래픽 컨텍스트 복구 중</span>
              </div>
            ) : null}
          </Preview>
          <div className="studio-side">
            <div className="studio-panel overflow-y-auto bg-[var(--panel)] px-4 py-2" style={{ touchAction: "pan-y" }}>
              {tab === "film" ? <FilmTab /> : null}
              {tab === "light" ? <LightTab onAuto={runAuto} /> : null}
              {tab === "color" ? <ColorTab /> : null}
              {tab === "curve" ? <CurveTab /> : null}
              {tab === "detail" ? <DetailTab /> : null}
            </div>
            <TabBar active={tab} onChange={setTab} disabled={!asset} />
          </div>
        </div>
        <input ref={fileInput} type="file" accept={ACCEPT_FALLBACK} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void openFile(f); e.target.value = ""; }} />
        <ProfileSheet
          open={profileOpen} onClose={() => setProfileOpen(false)} current={choice} detection={asset?.detection ?? null} onSelect={(c) => void selectProfile(c)}
          onLutChanged={() => renderer?.refreshSourceLut()} onError={(m) => toast(m)}
        />
        <ExifInspector key={asset?.id ?? "none"} open={exifOpen} onClose={() => setExifOpen(false)} asset={asset} file={file} demo={isDemo} />
        <ExportModal
          open={exportOpen} onClose={() => setExportOpen(false)} asset={asset} file={file} simId={state.simId} simLabel={frameLabel} renderer={renderer} params={params} editKey={editKey}
          toast={toast} onRunningChange={onExportRunning}
        />
        <ToastView item={toastItem} onDismiss={dismiss} />
      </div>
    </StudioContext.Provider>
  );
}

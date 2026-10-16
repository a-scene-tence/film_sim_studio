"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Slider } from "@/components/editor/Slider";
import { ToneCurveGraph } from "@/components/editor/ToneCurveGraph";
import {
  PROFILE_TABLE, SUPPORTED_EXTENSIONS, loadMedia, setSourceProfile,
  type LoadStage, type MediaAsset, type SourceProfileId,
} from "@/lib/media-loader";
import { computeAuto } from "@/lib/render/auto";
import { CURVE_PRESETS, CURVE_PRESET_LABEL, LINEAR_CURVE, type CurvePreset, type Zones } from "@/lib/render/curve";
import { listStoreLuts, loadManifest, loadStoreLut, storeSourceProfile, type ManifestSim } from "@/lib/render/luts";
import { ADJUST_SLIDERS, DEFAULT_PARAMS, effectiveParams, GRAIN_SLIDERS, isoFromSummary, type AdjustKey, type Level, type RenderParams } from "@/lib/render/params";
import { RECIPES, recipeGrain } from "@/lib/render/recipes";
import { FilmRenderer, type RendererInfo } from "@/lib/render/renderer";
import { gpuCpuProbe, photoPerf, tileSeamCheck, videoPerf, type ProbeReport } from "@/lib/render/verify";

const ACCEPT = ".arw,.dng,.raf,.cr3,.nef,.jpg,.jpeg,.png,.webp,.heic,.mp4,.mov,.webm";
const PROFILE_LABEL: Record<SourceProfileId, string> = {
  "srgb-image": "sRGB 이미지", rec709: "Rec.709", hlg: "HLG", pq: "PQ", slog3: "S-Log3", slog2: "S-Log2", flog: "F-Log", flog2: "F-Log2", clog3: "C-Log3",
  vlog: "V-Log", nlog: "N-Log", dlog: "D-Log", applelog: "Apple Log", samsunglog: "Samsung Log", dlogm: "D-Log M", "raw-linear": "RAW 선형",
};
const STAGE_LABEL: Record<LoadStage, string> = { sniff: "형식 판별", metadata: "메타데이터", preview: "프리뷰", decode: "디코드", proxy: "프록시", analyze: "분석", done: "완료" };
const LEVEL_LABEL = ["끔", "약", "강"] as const;
const ZONE_LABEL = ["블랙", "섀도", "미드톤", "라이트", "하이라이트"] as const;

const card = "rounded-2xl bg-neutral-900 p-4";
const btn = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-neutral-800 px-4 py-2 text-sm font-medium active:bg-neutral-700 disabled:opacity-40";
const chip = (on: boolean) => `inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm ${on ? "bg-amber-400 text-neutral-950" : "bg-neutral-800 text-neutral-200"}`;

type Brand = "fujifilm" | "ricoh";
interface StoreLutRow { id: string; name: string; role: string; sourceProfile: string | null }

function fmtTime(t: number): string {
  if (!Number.isFinite(t)) return "0:00";
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function RendererLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<FilmRenderer | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [asset, setAsset] = useState<MediaAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string>("");
  const [errors, setErrors] = useState<string[]>([]);
  const [params, setParamsState] = useState<RenderParams>(DEFAULT_PARAMS);
  const [sims, setSims] = useState<ManifestSim[]>([]);
  const [brand, setBrand] = useState<Brand>("fujifilm");
  const [info, setInfo] = useState<RendererInfo | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [storeLuts, setStoreLuts] = useState<StoreLutRow[]>([]);
  const [results, setResults] = useState<Record<string, string>>({});
  const [probeRows, setProbeRows] = useState<ProbeReport | null>(null);
  const [vid, setVid] = useState<{ t: number; d: number; playing: boolean; fps: number; dropped: number; tier: number }>({ t: 0, d: 0, playing: false, fps: 0, dropped: 0, tier: 1 });

  const pushError = useCallback((e: unknown) => setErrors((x) => [...x.slice(-4), e instanceof Error ? e.message : String(e)]), []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    let r: FilmRenderer;
    try {
      r = FilmRenderer.create(c);
    } catch (e) {
      // 둘 다 없으면 미지원 안내 (8bit 폴백 금지)
      queueMicrotask(() => setInitError(e instanceof Error ? e.message : String(e)));
      return;
    }
    rendererRef.current = r;
    r.onStatus = () => { setInfo(r.info()); setWarnings([...r.warnings]); };
    r.onError = pushError;
    queueMicrotask(() => { setInfo(r.info()); setWarnings([...r.warnings]); });
    loadManifest().then((m) => setSims([...m.sims].sort((a, b) => a.order - b.order))).catch(pushError);
    listStoreLuts().then((l) => setStoreLuts(l.map((m) => ({ id: m.id, name: m.name, role: m.role, sourceProfile: m.sourceProfile })))).catch(pushError);
    return () => { r.dispose(); rendererRef.current = null; };
  }, [pushError]);

  // 비디오 상태 표시
  useEffect(() => {
    if (asset?.kind !== "video") return;
    const id = setInterval(() => {
      const r = rendererRef.current;
      const v = r?.video.element();
      if (!r || !v) return;
      const s = r.video.stats();
      setVid({ t: v.currentTime, d: Number.isFinite(v.duration) ? v.duration : 0, playing: !v.paused, fps: s.presentedFps, dropped: s.dropped, tier: s.tier });
    }, 250);
    return () => clearInterval(id);
  }, [asset]);

  const apply = useCallback((p: RenderParams) => {
    setParamsState(p);
    rendererRef.current?.setParams(p);
  }, []);

  const onFile = async (file: File) => {
    const r = rendererRef.current;
    if (!r) return;
    setBusy(true);
    setErrors([]);
    setResults({});
    setProbeRows(null);
    try {
      const a = await loadMedia(file, { onProgress: (s, m) => setStage(`${STAGE_LABEL[s]} — ${m}`) });
      const iso = isoFromSummary(a.exif?.summary.iso);
      const p = { ...params, iso };
      if (a.kind === "video") await r.setVideoSource(a, file);
      else r.setPhotoSource(a);
      setAsset(a);
      apply(p);
      setStage("완료");
    } catch (e) {
      pushError(e);
    } finally {
      setBusy(false);
    }
  };

  const sim = sims.find((s) => s.id === params.sim) ?? null;
  const mono = sim?.mono ?? false;
  const eff = useMemo(() => effectiveParams(params, mono), [params, mono]);
  const recipe = RECIPES[params.sim];
  const disp = asset ? (asset.kind === "video" && asset.video ? (asset.video.rotation.orientation >= 5 ? { w: asset.video.rotation.codedHeight, h: asset.video.rotation.codedWidth } : { w: asset.video.rotation.codedWidth, h: asset.video.rotation.codedHeight }) : { w: asset.displaySize.width, h: asset.displaySize.height }) : null;

  const setAdjust = (k: AdjustKey, v: number) => apply({ ...params, adjust: { ...params.adjust, [k]: v } });
  const pickSim = (id: string) => apply({ ...params, sim: id, lookLutId: null, adjust: { ...params.adjust }, cce: "recipe", fxb: "recipe", hdf: "recipe" });

  const switchProfile = async (profile: SourceProfileId) => {
    if (!asset) return;
    try {
      const prim = PROFILE_TABLE.find((x) => x.id === profile)?.primaries;
      const next = await setSourceProfile(asset.id, profile, profile === "srgb-image" || profile === "rec709" ? undefined : prim);
      setAsset(next);
      rendererRef.current?.updateAsset(next);
      apply({ ...params });
    } catch (e) {
      pushError(e);
    }
  };

  const runAuto = async () => {
    if (!asset) return;
    try {
      let lut: { size: number; data: Float32Array } | undefined;
      const want = storeSourceProfile(asset.descriptor.profile);
      if (want) {
        const id = params.sourceLutId ?? storeLuts.find((l) => l.role === "source-transform" && l.sourceProfile === want)?.id;
        const l = id ? await loadStoreLut(id) : null;
        if (!l) throw new Error("자동 보정에 소스 변환 LUT 가 필요합니다 — /lab/luts 에서 공식 LUT 를 등록하세요.");
        lut = { size: l.size, data: l.data };
      }
      const r = computeAuto(asset, lut);
      apply({ ...params, adjust: r.adjust });
      setResults((x) => ({ ...x, auto: r.report.join(" / ") }));
    } catch (e) {
      pushError(e);
    }
  };

  const verify = async (key: string, fn: () => Promise<string>) => {
    setResults((x) => ({ ...x, [key]: "실행 중…" }));
    try {
      const s = await fn();
      setResults((x) => ({ ...x, [key]: s }));
    } catch (e) {
      setResults((x) => ({ ...x, [key]: `오류: ${e instanceof Error ? e.message : String(e)}` }));
    }
  };

  const r = rendererRef.current;
  const brandSims = sims.filter((s) => s.brand === brand);
  const curvePts = params.curve;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col overflow-x-hidden gap-4 px-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-[calc(env(safe-area-inset-top)+16px)]">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">렌더러 검증 (Step 3)</h1>
        <Link className={btn} href="/">홈</Link>
      </header>

      {initError ? <section className={`${card} border border-red-500 text-sm text-red-300`}>{initError}</section> : null}

      <section className={`${card} flex flex-col gap-3`}>
        <label className={`${btn} w-full cursor-pointer bg-amber-400 text-neutral-950`}>
          {busy ? "여는 중…" : "파일 선택"}
          <input type="file" accept={ACCEPT} className="hidden" disabled={busy || !!initError} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
        </label>
        <p className="text-xs text-neutral-500">{SUPPORTED_EXTENSIONS} · {stage}</p>
        {r ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-neutral-400">
            <dt>float 렌더</dt><dd>{r.caps.floatRender}</dd>
            <dt>RG32F 렌더</dt><dd>{String(r.caps.rg32fRenderable)}</dd>
            <dt>비디오 HALF_FLOAT 업로드</dt><dd>{String(r.caps.videoHalfFloatUpload)}</dd>
            <dt>최대 텍스처 / 3D</dt><dd>{r.caps.maxTextureSize} / {r.caps.max3DTextureSize}</dd>
            <dt>방향 판별</dt><dd>{info?.orientationProbe ? `${info.orientationProbe.status}${info.orientationProbe.note ? ` (${info.orientationProbe.note})` : ""}` : "미실행"}</dd>
            <dt>R / A / D</dt><dd>{info?.R ? `${info.R.width}×${info.R.height}` : "-"} / {info?.A ? `${info.A.width}×${info.A.height}` : "-"} / {info?.D ? `${info.D.width}×${info.D.height}` : "-"}</dd>
            <dt>uProfile / uOrient</dt><dd>{info?.profileIndex ?? "-"} / {info?.orient ?? "-"}</dd>
            <dt>대기광 A</dt><dd>{info ? info.atm.map((v) => v.toFixed(3)).join(", ") : "-"}</dd>
          </dl>
        ) : null}
        <button className={btn} disabled={!r} onClick={() => r && void r.runOrientationProbe().then(() => setInfo(r.info())).catch(pushError)}>방향 판별 실행</button>
        {asset ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-full bg-emerald-700 px-3 py-1">{PROFILE_LABEL[asset.descriptor.profile]}</span>
              <span className="text-xs text-neutral-400">{asset.detection ? `${asset.detection.confidence}${asset.detection.autoApply ? "" : " (제안)"}` : ""} · {asset.descriptor.primaries} · {asset.descriptor.range}</span>
            </div>
            {asset.kind === "video" ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {(["rec709", "hlg", "slog3", "slog2", "flog", "flog2", "clog3", "vlog", "nlog", "dlog", "applelog", "samsunglog", "dlogm"] as SourceProfileId[]).map((p) => (
                  <button key={p} className={chip(asset.descriptor.profile === p)} onClick={() => void switchProfile(p)}>{PROFILE_LABEL[p]}</button>
                ))}
              </div>
            ) : null}
            {storeSourceProfile(asset.descriptor.profile) ? (
              <label className="flex flex-col gap-1 text-sm">소스 변환 LUT
                <select className="min-h-11 rounded-xl bg-neutral-800 px-3" value={params.sourceLutId ?? ""} onChange={(e) => apply({ ...params, sourceLutId: e.target.value || null })}>
                  <option value="">자동 (프로파일 일치)</option>
                  {storeLuts.filter((l) => l.role === "source-transform").map((l) => <option key={l.id} value={l.id}>{l.name} ({l.sourceProfile})</option>)}
                </select>
                <span className="text-xs text-neutral-500">현재: {info?.sourceLutName ?? "-"} · <Link className="underline" href="/lab/luts">LUT 등록</Link></span>
              </label>
            ) : null}
          </div>
        ) : null}
        {warnings.length ? <ul className="list-disc pl-5 text-xs text-amber-300">{warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
        {asset?.warnings.length ? <ul className="list-disc pl-5 text-xs text-amber-300">{asset.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
        {errors.length ? <ul className="list-disc pl-5 text-xs text-red-300">{errors.map((w, i) => <li key={i}>{w}</li>)}</ul> : null}
      </section>

      <canvas ref={canvasRef} className="w-full rounded-2xl bg-black" style={{ aspectRatio: disp ? `${disp.w} / ${disp.h}` : "3 / 2" }} />

      {asset?.kind === "video" ? (
        <section className={`${card} flex flex-col gap-2`}>
          <div className="flex items-center gap-2">
            <button className={btn} onClick={() => { if (!r) return; if (vid.playing) r.video.pause(); else void r.video.play().catch(pushError); }}>{vid.playing ? "일시정지" : "재생"}</button>
            <span className="tabular-nums text-sm">{fmtTime(vid.t)} / {fmtTime(vid.d)}</span>
          </div>
          <input type="range" className="h-11 w-full accent-amber-400" min={0} max={vid.d || 0} step={0.01} value={vid.t} aria-label="탐색" onChange={(e) => r?.video.seek(Number(e.target.value))} />
          <p className="text-xs text-neutral-400">표시 {vid.fps} fps · 드롭 {vid.dropped} · tier {vid.tier}</p>
        </section>
      ) : null}

      <section className={`${card} flex flex-col gap-3`}>
        <div className="flex gap-2">
          {(["fujifilm", "ricoh"] as Brand[]).map((b) => (
            <button key={b} className={chip(brand === b)} onClick={() => setBrand(b)}>{b === "fujifilm" ? `FUJIFILM ${sims.filter((s) => s.brand === "fujifilm").length}` : `RICOH GR ${sims.filter((s) => s.brand === "ricoh").length}`}</button>
          ))}
          <button className={chip(params.sim === "none" && !params.lookLutId)} onClick={() => pickSim("none")}>원본</button>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {brandSims.map((s) => <button key={s.id} className={chip(params.sim === s.id && !params.lookLutId)} onClick={() => pickSim(s.id)}>{s.ko}</button>)}
        </div>
        {recipe ? (
          <p className="text-xs text-neutral-500">
            레시피: 선명도 {recipe.sharpen} · 명료도 {recipe.clarity} · 하이라이트 {recipe.highlights} · 쉐도우 {recipe.shadows} · 비네팅 {recipe.vignette} · 그레인 {(() => { const g = recipeGrain(recipe, params.iso); return `${g.amount}/${g.size}${recipe.grain === "acros-iso" ? ` (ISO ${params.iso ?? "미기록→200"})` : ""}`; })()} · CCE {LEVEL_LABEL[recipe.cce]} · FX블루 {LEVEL_LABEL[recipe.fxb]} · HDF {recipe.hdf ? "ON" : "OFF"}
          </p>
        ) : null}
        <label className="flex flex-col gap-1 text-sm">외부 Look LUT
          <select className="min-h-11 rounded-xl bg-neutral-800 px-3" value={params.lookLutId ?? ""} onChange={(e) => apply({ ...params, lookLutId: e.target.value || null })}>
            <option value="">사용 안 함</option>
            {storeLuts.filter((l) => l.role === "look").map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      </section>

      <section className={`${card} flex flex-col gap-3`}>
        {brand === "fujifilm" && !mono ? (
          <>
            {([["cce", "컬러 크롬 이펙트"], ["fxb", "컬러 크롬 FX 블루"]] as const).map(([k, label]) => (
              <div key={k} className="flex flex-wrap items-center gap-2">
                <span className="w-36 text-sm">{label}</span>
                {([0, 1, 2] as Level[]).map((lv) => <button key={lv} className={chip(eff[k] === lv)} onClick={() => apply({ ...params, [k]: lv })}>{LEVEL_LABEL[lv]}</button>)}
              </div>
            ))}
          </>
        ) : null}
        {brand === "ricoh" ? (
          <div className="flex items-center gap-2">
            <span className="w-36 text-sm">HDF</span>
            <button className={chip(eff.hdf)} onClick={() => apply({ ...params, hdf: !eff.hdf })}>{eff.hdf ? "HDF ON" : "HDF OFF"}</button>
          </div>
        ) : null}
        {GRAIN_SLIDERS.map((s) => <Slider key={s.key} label={s.label} min={s.min} max={s.max} step={s.step} value={params.adjust[s.key]} effective={eff.adjust[s.key]} onChange={(v) => setAdjust(s.key, v)} />)}
      </section>

      <section className={`${card} flex flex-col gap-1`}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-medium">보정</h2>
          <button className={btn} disabled={!asset} onClick={() => void runAuto()}>자동</button>
        </div>
        {results.auto ? <p className="text-xs text-neutral-500">{results.auto}</p> : null}
        {ADJUST_SLIDERS.map((s) => <Slider key={s.key} label={s.label} min={s.min} max={s.max} step={s.step} value={params.adjust[s.key]} effective={eff.adjust[s.key]} onChange={(v) => setAdjust(s.key, v)} />)}
      </section>

      <section className={`${card} flex flex-col gap-3`}>
        <h2 className="font-medium">톤 커브</h2>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(Object.keys(CURVE_PRESETS) as CurvePreset[]).map((p) => (
            <button key={p} className={chip(curvePts.preset === p && curvePts.points === null)} onClick={() => apply({ ...params, curve: { preset: p, points: null, zones: params.curve.zones } })}>{CURVE_PRESET_LABEL[p]}</button>
          ))}
        </div>
        <ToneCurveGraph value={params.curve} onChange={(c) => apply({ ...params, curve: c })} />
        {ZONE_LABEL.map((label, k) => (
          <Slider key={label} label={label} min={-100} max={100} step={1} value={params.curve.zones[k]!}
            onChange={(v) => { const z = [...params.curve.zones] as Zones; z[k] = v; apply({ ...params, curve: { ...params.curve, zones: z } }); }} />
        ))}
        <button className={btn} onClick={() => apply({ ...params, curve: LINEAR_CURVE })}>커브 초기화</button>
      </section>

      <section className={`${card} flex flex-col gap-2`}>
        <h2 className="font-medium">검증</h2>
        <button className={btn} disabled={!asset || !r || asset.kind === "video"} onClick={() => r && asset && void verify("probe", async () => {
          const rep = await gpuCpuProbe(r, asset, 0, 2);
          setProbeRows(rep);
          return `${rep.pass ? "PASS" : "FAIL"} — 최대 차 ${rep.maxDiff255.toFixed(3)}/255 (허용 2/255)`;
        })}>GPU↔CPU 프로브</button>
        {results.probe ? <p className="text-xs">{results.probe}</p> : null}
        <button className={btn} disabled={!asset || !r || asset.kind === "video"} onClick={() => r && asset && void verify("grain", async () => {
          const rep = await gpuCpuProbe(r, asset, 50, 3);
          setProbeRows(rep);
          return `${rep.pass ? "PASS" : "FAIL"} — 최대 차 ${rep.maxDiff255.toFixed(3)}/255 (허용 3/255, 그레인 50)`;
        })}>그레인 프로브</button>
        {results.grain ? <p className="text-xs">{results.grain}</p> : null}
        <button className={btn} disabled={!asset || !r || asset.kind === "video"} onClick={() => r && asset && void verify("seam", async () => {
          const rep = await tileSeamCheck(r, asset);
          return `${rep.pass ? "PASS" : "FAIL"} — 최대 차 ${rep.maxDiff255}/255 (허용 1/255) · ${rep.note} · 영역 ${rep.rect.x},${rep.rect.y} ${rep.rect.width}×${rep.rect.height}`;
        })}>타일 이음새 검증</button>
        {results.seam ? <p className="text-xs">{results.seam}</p> : null}
        <button className={btn} disabled={!asset || !r} onClick={() => r && asset && void verify("perf", async () => {
          if (asset.kind === "video") {
            const p = await videoPerf(r);
            return `비디오 10초: 표시 ${p.video!.presentedFps} fps · 드롭 +${p.video!.dropped} · tier ${p.video!.tier}`;
          }
          const p = await photoPerf(r);
          return `사진 renderNow 30회 평균 cpuMs ${p.photoAvgCpuMs!.toFixed(2)} · 패스 ${p.photoAvgPasses}`;
        })}>성능</button>
        {results.perf ? <p className="text-xs">{results.perf}</p> : null}
        {probeRows ? (
          <div className="mt-2 overflow-x-auto"><table className="w-full text-[11px] tabular-nums text-neutral-400">
            <thead><tr><th className="text-left">uv</th><th className="text-left">GPU</th><th className="text-left">CPU</th><th className="text-right">차/255</th></tr></thead>
            <tbody>
              {probeRows.rows.map((row, i) => (
                <tr key={i}>
                  <td>{row.u.toFixed(3)},{row.v.toFixed(3)}</td>
                  <td>{row.gpu.map((x) => x.toFixed(4)).join(" ")}</td>
                  <td>{row.cpu.map((x) => x.toFixed(4)).join(" ")}</td>
                  <td className={`text-right ${row.diff255 > probeRows.tol255 ? "text-red-400" : ""}`}>{row.diff255.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : null}
      </section>
    </main>
  );
}

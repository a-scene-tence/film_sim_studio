"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { LUT_SIZE } from "@/lib/color/fse/constants.mjs";
import { shaperEnc, srgbDec, toneInv } from "@/lib/color/fse/engine.mjs";
import { encodeLutInput } from "@/lib/color/fse/lut-domain.mjs";
import { tetraSample } from "@/lib/color/fse/tetra.mjs";
import { decodeBinLut } from "@/lib/lut/binLut";
import { deleteLut, getLut, listLuts, lutIdFromSha256, putLut, type LutMeta } from "@/lib/lut/lutStore";
import type { LutData, LutInputDomain, LutRole } from "@/lib/lut/types";
import type { LutParseRequest, LutParseResponse } from "@/workers/lut-parse.worker";

type Vec3 = [number, number, number];
type Brand = "fujifilm" | "ricoh";
type SourceProfile = "samsung-log" | "dji-dlog-m";

interface ManifestSim {
  id: string;
  brand: Brand;
  ko: string;
  en: string;
  mono: boolean;
  order: number;
  cube: string;
  bin: string;
  sha256Cube: string;
  sha256Bin: string;
  shaderHints: Record<string, unknown>;
}

interface Manifest {
  schema: string;
  size: number;
  sims: ManifestSim[];
}

const MANIFEST_SCHEMA = "fse-lut-manifest/1";
const PREVIEW_W = 256;
const PREVIEW_H = 96;
const BAND_H = 48;

const DOMAIN_LABELS: Record<LutInputDomain, string> = {
  "srgb-display": "sRGB 표시 (기본)",
  "rec709-bt1886": "Rec.709 BT.1886",
  "fsh-v1": "FSH-v1 셰이퍼",
  "slog3-sgamut3cine": "S-Log3 / S-Gamut3.Cine",
};
const ROLE_LABELS: Record<LutRole, string> = { look: "룩 (look)", "source-transform": "소스 변환 (source-transform)" };
const PROFILE_LABELS: Record<SourceProfile, string> = { "samsung-log": "Samsung Log", "dji-dlog-m": "DJI D-Log M" };

/** HSV → sRGB 표시값 */
function hsvToRgb(h: number, s: number, v: number): Vec3 {
  const c = v * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return [r + m, g + m, b + m];
}

/** 미리보기 입력: 위 = 회색 램프, 아래 = 색상 스윕 (WS 선형) */
function previewInputs(): { ramp: Vec3[]; sweep: Vec3[] } {
  const ramp: Vec3[] = [];
  const sweep: Vec3[] = [];
  for (let col = 0; col < PREVIEW_W; col++) {
    const t = col / (PREVIEW_W - 1);
    const x = 0.18 * Math.pow(2, -6 + 9 * t);
    ramp.push([x, x, x]);
    const disp = hsvToRgb(360 * t, 0.8, 0.85);
    sweep.push([toneInv(srgbDec(disp[0])), toneInv(srgbDec(disp[1])), toneInv(srgbDec(disp[2]))]);
  }
  return { ramp, sweep };
}

function drawPreview(canvas: HTMLCanvasElement, sample: (x: Vec3) => Vec3) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(PREVIEW_W, PREVIEW_H);
  const { ramp, sweep } = previewInputs();
  for (let col = 0; col < PREVIEW_W; col++) {
    const top = sample(ramp[col] as Vec3);
    const bottom = sample(sweep[col] as Vec3);
    for (let row = 0; row < PREVIEW_H; row++) {
      const v = row < BAND_H ? top : bottom;
      const o = (row * PREVIEW_W + col) * 4;
      img.data[o] = Math.round(Math.min(1, Math.max(0, v[0])) * 255);
      img.data[o + 1] = Math.round(Math.min(1, Math.max(0, v[1])) * 255);
      img.data[o + 2] = Math.round(Math.min(1, Math.max(0, v[2])) * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** 내장 LUT: FSH-v1 셰이퍼로 인코딩해 샘플 */
function builtinSampler(data: Float32Array, N: number) {
  return (x: Vec3): Vec3 => tetraSample(data, N, [shaperEnc(x[0]), shaperEnc(x[1]), shaperEnc(x[2])]);
}

/** 업로드 LUT: §7 입력 도메인 → 비디오 범위 → DOMAIN 정규화 → 사면체 → 출력 비디오 범위 */
function userSampler(lut: LutData) {
  return (x: Vec3): Vec3 => {
    const u = encodeLutInput(lut.inputDomain, x);
    for (let c = 0; c < 3; c++) {
      let v = u[c] as number;
      if (lut.inVideoRange) v = (v * 876) / 1023 + 64 / 1023;
      const lo = lut.domainMin[c] as number;
      const hi = lut.domainMax[c] as number;
      if (lo !== 0 || hi !== 1) v = (v - lo) / (hi - lo);
      u[c] = v;
    }
    const out = tetraSample(lut.data, lut.size, u);
    if (lut.outVideoRange) for (let c = 0; c < 3; c++) out[c] = ((out[c] as number) * 1023 - 64) / 876;
    return out;
  };
}

/** 업로드 시각 (이벤트 핸들러에서만 호출) */
function nowMs(): number {
  return Date.now();
}

function parseInWorker(req: LutParseRequest): Promise<LutParseResponse> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../../../workers/lut-parse.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<LutParseResponse>) => {
      worker.terminate();
      resolve(ev.data);
    };
    worker.onerror = (ev) => {
      worker.terminate();
      reject(new Error(ev.message || "워커 오류"));
    };
    worker.postMessage(req, [req.bytes]);
  });
}

const btn = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl px-4 text-sm font-medium";
const field = "min-h-11 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 text-sm";

export default function LutLabPage() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [brand, setBrand] = useState<Brand>("fujifilm");
  const [selected, setSelected] = useState<string | null>(null);
  const [previewLabel, setPreviewLabel] = useState<string>("항목을 선택하면 미리보기가 표시됩니다");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState<LutInputDomain>("srgb-display");
  const [role, setRole] = useState<LutRole>("look");
  const [profile, setProfile] = useState<SourceProfile | "">("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [saved, setSaved] = useState<LutMeta[]>([]);

  const refreshSaved = useCallback(async () => {
    try {
      setSaved(await listLuts());
    } catch (e) {
      setStatus(`저장 목록을 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)} — 브라우저의 사이트 데이터 저장이 허용되어 있는지 확인하세요.`);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/luts/manifest.json?v=${encodeURIComponent(MANIFEST_SCHEMA)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Manifest>;
      })
      .then((m) => {
        if (!cancelled) setManifest(m);
      })
      .catch((e: unknown) => {
        if (!cancelled) setManifestError(`내장 LUT 목록을 불러오지 못했습니다 (${e instanceof Error ? e.message : String(e)}). 네트워크 상태를 확인한 뒤 새로고침하세요.`);
      });
    listLuts()
      .then((list) => {
        if (!cancelled) setSaved(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const showBuiltin = async (sim: ManifestSim, size: number) => {
    setSelected(sim.id);
    setPreviewLabel(`${sim.ko} · 불러오는 중…`);
    try {
      const r = await fetch(`${sim.bin}?v=${sim.sha256Bin.slice(0, 12)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = decodeBinLut(await r.arrayBuffer(), size);
      if (canvasRef.current) drawPreview(canvasRef.current, builtinSampler(data, size));
      setPreviewLabel(`${sim.ko} (${sim.en}) · ${size}³`);
    } catch (e) {
      setPreviewLabel(`${sim.ko}: LUT 를 불러오지 못했습니다 (${e instanceof Error ? e.message : String(e)}). 새로고침 후 다시 시도하세요.`);
    }
  };

  const showUser = async (meta: LutMeta) => {
    setSelected(meta.id);
    try {
      const lut = await getLut(meta.id);
      if (!lut) throw new Error("저장소에 없음");
      if (canvasRef.current) drawPreview(canvasRef.current, userSampler(lut));
      setPreviewLabel(`${lut.name} · ${lut.size}³ · ${DOMAIN_LABELS[lut.inputDomain]}`);
    } catch (e) {
      setPreviewLabel(`업로드 LUT 를 불러오지 못했습니다 (${e instanceof Error ? e.message : String(e)}). 다시 업로드해 주세요.`);
    }
  };

  const onPickFile = (f: File | null) => {
    setFile(f);
    setName(f ? f.name : "");
    setErrors([]);
    setWarnings([]);
    setStatus(null);
  };

  const onUpload = async () => {
    if (!file) return;
    if (role === "source-transform" && profile === "") {
      setErrors(["소스 변환 LUT 는 소스 프로파일(Samsung Log / DJI D-Log M)을 반드시 선택해야 합니다."]);
      return;
    }
    setBusy(true);
    setErrors([]);
    setWarnings([]);
    setStatus("워커에서 파싱하는 중…");
    try {
      const lower = file.name.toLowerCase();
      const kind = lower.endsWith(".png") ? "hald" : "cube";
      const res = await parseInWorker({ kind, bytes: await file.arrayBuffer(), fileName: file.name });
      setWarnings(res.lut.warnings);
      if (res.errors.length > 0) {
        setErrors(res.errors);
        setStatus("파싱에 실패해 저장하지 않았습니다. 오류를 확인하고 파일을 고친 뒤 다시 올려 주세요.");
        return;
      }
      const lut: LutData = {
        ...res.lut,
        id: lutIdFromSha256(res.sha256),
        name: name.trim() || file.name,
        inputDomain: domain,
        role,
        sourceProfile: role === "source-transform" && profile !== "" ? profile : null,
        sourceFileName: file.name,
        sha256: res.sha256,
        createdAt: nowMs(),
      };
      await putLut(lut);
      await refreshSaved();
      setStatus(`저장했습니다: ${lut.name} (${lut.size}³)`);
      setSelected(lut.id);
      if (canvasRef.current) drawPreview(canvasRef.current, userSampler(lut));
      setPreviewLabel(`${lut.name} · ${lut.size}³ · ${DOMAIN_LABELS[lut.inputDomain]}`);
    } catch (e) {
      setErrors([`업로드 처리 중 오류: ${e instanceof Error ? e.message : String(e)} — 다시 시도하거나 다른 브라우저에서 열어 보세요.`]);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (meta: LutMeta) => {
    if (!window.confirm(`"${meta.name}" LUT 를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    await deleteLut(meta.id);
    if (selected === meta.id) setSelected(null);
    await refreshSaved();
  };

  const sims = manifest?.sims.filter((s) => s.brand === brand) ?? [];
  const fujiCount = manifest?.sims.filter((s) => s.brand === "fujifilm").length ?? 20;
  const ricohCount = manifest?.sims.filter((s) => s.brand === "ricoh").length ?? 12;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-6">
      <header className="flex items-center gap-2">
        <Link href="/" className={`${btn} bg-neutral-900`} aria-label="홈으로">
          ←
        </Link>
        <h1 className="text-xl font-semibold">LUT 실험실</h1>
      </header>

      <section className="flex flex-col gap-2">
        <canvas
          ref={canvasRef}
          width={PREVIEW_W}
          height={PREVIEW_H}
          className="w-full rounded-lg bg-neutral-900 [image-rendering:pixelated]"
          aria-label="LUT 미리보기: 위는 회색 램프, 아래는 색상 스윕"
        />
        <p className="text-xs text-neutral-400">{previewLabel}</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">내장 LUT (FSE-v2)</h2>
        <div className="flex gap-2" role="tablist">
          {(["fujifilm", "ricoh"] as const).map((b) => (
            <button
              key={b}
              role="tab"
              aria-selected={brand === b}
              onClick={() => setBrand(b)}
              className={`${btn} flex-1 ${brand === b ? "bg-neutral-100 text-neutral-900" : "bg-neutral-900"}`}
            >
              {b === "fujifilm" ? `FUJIFILM ${fujiCount}` : `RICOH GR ${ricohCount}`}
            </button>
          ))}
        </div>
        {manifestError && <p className="text-sm text-red-400">{manifestError}</p>}
        {!manifest && !manifestError && <p className="text-sm text-neutral-400">불러오는 중…</p>}
        <ul className="grid grid-cols-2 gap-2">
          {manifest &&
            sims.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => showBuiltin(s, manifest.size)}
                  className={`${btn} w-full flex-col items-start py-2 text-left ${selected === s.id ? "bg-neutral-700" : "bg-neutral-900"}`}
                >
                  <span>{s.ko}</span>
                  <span className="text-xs text-neutral-400">{s.en}</span>
                </button>
              </li>
            ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">외부 LUT 업로드 (.cube / HaldCLUT PNG)</h2>
        <label className={`${btn} cursor-pointer bg-neutral-900`}>
          {file ? file.name : "파일 선택"}
          <input type="file" accept=".cube,.png" className="sr-only" onChange={(e) => onPickFile(e.target.files?.[0] ?? null)} />
        </label>
        {file && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              이름
              <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              입력 도메인
              <select className={field} value={domain} onChange={(e) => setDomain(e.target.value as LutInputDomain)}>
                {(Object.keys(DOMAIN_LABELS) as LutInputDomain[]).map((d) => (
                  <option key={d} value={d}>
                    {DOMAIN_LABELS[d]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              역할
              <select className={field} value={role} onChange={(e) => setRole(e.target.value as LutRole)}>
                {(Object.keys(ROLE_LABELS) as LutRole[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
            {role === "source-transform" && (
              <label className="flex flex-col gap-1 text-sm">
                소스 프로파일 (필수)
                <select className={field} value={profile} onChange={(e) => setProfile(e.target.value as SourceProfile | "")}>
                  <option value="">선택하세요</option>
                  {(Object.keys(PROFILE_LABELS) as SourceProfile[]).map((p) => (
                    <option key={p} value={p}>
                      {PROFILE_LABELS[p]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button onClick={onUpload} disabled={busy} className={`${btn} bg-neutral-100 text-neutral-900 disabled:opacity-50`}>
              {busy ? "처리 중…" : "파싱 후 저장"}
            </button>
          </div>
        )}
        {status && <p className="text-sm text-neutral-300">{status}</p>}
        {errors.length > 0 && (
          <ul className="list-disc pl-5 text-sm text-red-400">
            {errors.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        )}
        {warnings.length > 0 && (
          <ul className="list-disc pl-5 text-sm text-amber-300">
            {warnings.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">저장된 LUT</h2>
        {saved.length === 0 && <p className="text-sm text-neutral-400">저장된 LUT 가 없습니다.</p>}
        <ul className="flex flex-col gap-2">
          {saved.map((m) => (
            <li key={m.id} className="flex items-center gap-2">
              <button
                onClick={() => showUser(m)}
                className={`${btn} flex-1 flex-col items-start py-2 text-left ${selected === m.id ? "bg-neutral-700" : "bg-neutral-900"}`}
              >
                <span>{m.name}</span>
                <span className="text-xs text-neutral-400">
                  {m.size}³ · {DOMAIN_LABELS[m.inputDomain]} · {ROLE_LABELS[m.role]}
                  {m.sourceProfile ? ` · ${PROFILE_LABELS[m.sourceProfile]}` : ""}
                </span>
              </button>
              <button onClick={() => onDelete(m)} className={`${btn} bg-red-950 text-red-300`} aria-label={`${m.name} 삭제`}>
                삭제
              </button>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-neutral-500">모든 처리는 이 기기 안에서만 이루어지며 파일은 서버로 전송되지 않습니다. 내장 LUT 격자: {LUT_SIZE}³</p>
    </main>
  );
}

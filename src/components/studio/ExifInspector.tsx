"use client";
// Step 4 §7-6 EXIF 인스펙터 (전체 화면 시트): 요약 카드 + IFD 그룹별 접이식 전체 목록 + 검색. 동영상은 미디어 정보.
import { useEffect, useMemo, useState } from "react";
import { readExifTags } from "@/lib/exif-manager";
import type { MediaAsset } from "@/lib/media-loader";
import { PROFILE_LABEL } from "@/lib/render/binding";
import { buildExifCard } from "@/lib/studio/exif-format";
import type { VideoMetaInfo } from "@/lib/export/video-meta";
import { BottomSheet } from "./BottomSheet";
import { IconChevron } from "./icons";

const CONF_LABEL = { tag: "태그", metadata: "메타데이터", filename: "파일명", "histogram-suggestion": "히스토그램 제안", default: "기본값" } as const;

function Card({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-[84px_1fr] gap-x-3 gap-y-1.5 rounded-[12px] bg-[var(--panel-2)] p-3 text-[13px]">
      {rows.map(([k, v]) => (<div key={k} className="contents"><dt className="text-[var(--text-2)]">{k}</dt><dd className="min-w-0 break-words tnum">{v}</dd></div>))}
    </dl>
  );
}

export function ExifInspector({ open, onClose, asset, file, demo }: { open: boolean; onClose(): void; asset: MediaAsset | null; file: File | null; demo: boolean }) {
  const [q, setQ] = useState("");
  const [tags, setTags] = useState<Record<string, unknown> | null>(null);
  const [video, setVideo] = useState<VideoMetaInfo | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ ifd0: true, exif: true });
  const assetId = asset?.id ?? null;

  useEffect(() => {
    if (!open || !asset || !file) return;
    let alive = true;
    if (asset.kind === "video") {
      void import("@/lib/export/video-meta").then((m) => m.readVideoMetadata(file)).then((v) => { if (alive) setVideo(v); }).catch(() => { if (alive) setVideo({ tags: [], audio: null }); });
    } else {
      void readExifTags(file).then((t) => { if (alive) setTags(t); });
    }
    return () => { alive = false; };
  }, [open, asset, file, assetId]);

  const needle = q.trim().toLowerCase();
  const groups = useMemo(() => {
    const gs = asset?.exif?.groups ?? [];
    return gs.map((g) => ({ ...g, rows: needle ? g.rows.filter((r) => r.key.toLowerCase().includes(needle) || r.value.toLowerCase().includes(needle)) : g.rows })).filter((g) => g.rows.length > 0);
  }, [asset, needle]);

  const title = <>EXIF{demo ? <span className="rounded-full bg-[var(--panel-2)] px-2 py-0.5 text-[11px] text-[var(--accent)]">데모</span> : null}</>;

  let body: React.ReactNode = null;
  if (asset && asset.kind === "video" && asset.video) {
    const v = asset.video;
    const det = asset.detection;
    const c = v.colour;
    const rows: Array<[string, string]> = [
      ["컨테이너", v.container.toUpperCase()], ["비디오 코덱", `${v.codec} (${v.codecFourcc})`], ["해상도", `${v.width} × ${v.height}`], ["회전", `${v.rotation.orientation === 1 ? "없음" : `EXIF 방향 ${v.rotation.orientation}`}`],
      ["fps", String(Math.round(v.fps * 100) / 100)], ["길이", `${v.durationSec.toFixed(2)} s`], ["비트레이트", `${(v.bitrateBps / 1e6).toFixed(1)} Mbps`],
      ["색 정보", `primaries ${c.primaries ?? "—"} / transfer ${c.transfer ?? "—"} / matrix ${c.matrix ?? "—"} / ${c.fullRange === null ? "range —" : c.fullRange ? "full" : "limited"}`],
      ["Log 감지", det ? `${PROFILE_LABEL[det.profile]} · 신뢰도 ${CONF_LABEL[det.confidence]}${det.autoApply ? "" : " (제안)"}` : "—"],
      ["오디오", v.hasAudio ? `${v.audioCodec ?? "—"} · ${video?.audio?.channels ?? "—"}ch · ${video?.audio?.sampleRate ?? v.audioSampleRate ?? "—"} Hz` : "없음"],
    ];
    body = (
      <div className="flex flex-col gap-3">
        <Card rows={rows} />
        <h3 className="text-[13px] text-[var(--text-2)]">메타데이터 태그</h3>
        {video && video.tags.length > 0 ? <Card rows={video.tags.map((t) => [t.key, t.value] as [string, string])} /> : <p className="text-[13px] text-[var(--text-2)]">{video ? "태그가 없습니다" : "불러오는 중"}</p>}
      </div>
    );
  } else if (asset) {
    const card = buildExifCard(tags ?? {}, asset.displaySize);
    body = (
      <div className="flex flex-col gap-3">
        <Card rows={[["바디", card.body], ["렌즈", card.lens], ["조리개", card.aperture], ["셔터", card.shutter], ["ISO", card.iso], ["초점거리", card.focal], ["촬영 일시", card.dateTime], ["해상도", card.resolution]]} />
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="태그명·값 검색" aria-label="EXIF 검색"
          className="h-11 rounded-[10px] border border-[var(--line)] bg-[var(--panel-2)] px-3 text-[16px] text-[var(--text)] outline-none"
        />
        {groups.length === 0 ? <p className="text-[13px] text-[var(--text-2)]">{asset.exif ? "표시할 태그가 없습니다" : "EXIF 정보가 없습니다"}</p> : null}
        {groups.map((g) => {
          const isOpen = needle ? true : (openGroups[g.id] ?? false);
          return (
            <section key={g.id} className="rounded-[12px] border border-[var(--line)]">
              <button type="button" aria-expanded={isOpen} className="flex min-h-11 w-full items-center justify-between px-3 text-[14px] font-semibold" onClick={() => setOpenGroups((o) => ({ ...o, [g.id]: !isOpen }))}>
                <span>{g.label} <span className="font-normal text-[var(--text-2)]">({g.rows.length})</span></span>
                <span style={{ transform: isOpen ? "rotate(90deg)" : undefined }}><IconChevron size={18} /></span>
              </button>
              {isOpen ? (
                <ul className="border-t border-[var(--line)] px-3 py-1 text-[12px]">
                  {g.rows.map((r) => (<li key={r.key} className="flex gap-2 py-1"><span className="w-[42%] shrink-0 break-words text-[var(--text-2)]">{r.key}</span><span className="min-w-0 break-words">·&nbsp;{r.value}</span></li>))}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>
    );
  }
  return <BottomSheet open={open} onClose={onClose} title={title} full>{body}</BottomSheet>;
}

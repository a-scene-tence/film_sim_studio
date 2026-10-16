"use client";
import { useState } from "react";
import { RecipeList } from "../RecipeList";
import { useStudio } from "../StudioContext";
import { StateSlider } from "./common";

type Seg = "fujifilm" | "ricoh" | "recipes";

/** 76×104 카드: 76×76 썸네일 + 한글명 11px 최대 2줄 */
function Card({ id, name, selected, thumb, onPick }: { id: string | null; name: string; selected: boolean; thumb?: string; onPick(): void }) {
  return (
    <button
      type="button" aria-label={name} aria-pressed={selected} data-sim={id ?? "none"}
      className="flex shrink-0 snap-start flex-col items-center" style={{ width: 76, height: 104 }} onClick={onPick}
    >
      <span className="relative block overflow-hidden rounded-[8px] bg-[var(--panel-2)]" style={{ width: 76, height: 76, boxSizing: "border-box", border: selected ? "2px solid var(--accent)" : "2px solid transparent" }}>
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" width={76} height={76} className="block h-full w-full object-cover" draggable={false} />
        ) : (
          <span className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] leading-tight text-[var(--text-2)]">{name}</span>
        )}
      </span>
      <span className="mt-1 line-clamp-2 w-full text-center text-[11px] leading-tight" style={{ color: selected ? "var(--accent)" : "var(--text)" }}>{name}</span>
    </button>
  );
}

export function FilmTab() {
  const { state, dispatch, sims, thumbs, iso, hasMedia } = useStudio();
  const [seg, setSeg] = useState<Seg>("fujifilm");
  const fuji = sims.filter((s) => s.brand === "fujifilm");
  const ricoh = sims.filter((s) => s.brand === "ricoh");
  const list = seg === "fujifilm" ? fuji : ricoh;
  const pick = (id: string | null) => dispatch({ type: "selectSim", simId: id, iso });
  return (
    <div className="flex flex-col gap-2">
      <div role="tablist" className="flex h-11 overflow-hidden rounded-[10px] border border-[var(--line)]">
        {([["fujifilm", `FUJIFILM ${fuji.length}`], ["ricoh", `RICOH GR ${ricoh.length}`], ["recipes", "내 레시피"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={seg === id} className="flex-1 text-[13px]" style={seg === id ? { background: "var(--panel-2)", color: "var(--accent)", fontWeight: 700 } : { color: "var(--text-2)" }} onClick={() => setSeg(id)}>{label}</button>
        ))}
      </div>
      {seg === "recipes" ? (
        <RecipeList />
      ) : (
        <>
          <div className="hide-scrollbar flex gap-2 overflow-x-auto pb-1" style={{ touchAction: "pan-x", scrollSnapType: "x proximity" }}>
            <Card id={null} name="필름 없음" selected={state.simId === null} thumb={thumbs.none} onPick={() => pick(null)} />
            {list.map((s) => <Card key={s.id} id={s.id} name={s.ko} selected={state.simId === s.id} thumb={thumbs[s.id]} onPick={() => pick(s.id)} />)}
          </div>
          <StateSlider k="filmStrength" disabled={!hasMedia} />
        </>
      )}
    </div>
  );
}


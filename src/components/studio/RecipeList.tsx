"use client";
// Step 4 §7-5 [내 레시피]: 저장·가져오기·내보내기, 목록(이름 / "{필름 한글명} · {YYYY-MM-DD}" / ⋯ 메뉴 이름 변경·삭제)
import { useEffect, useRef, useState } from "react";
import {
  applyRecipe, defaultRecipeName, exportFileName, exportRecipes, importRecipes, importToast, loadRecipes, MAX_RECIPES, recipeFromState, saveRecipes, type Recipe,
} from "@/lib/studio/recipes";
import { simRecipe } from "@/lib/studio/state";
import { BottomSheet } from "./BottomSheet";
import { IconMore } from "./icons";
import { useStudio } from "./StudioContext";

const btn = "min-h-11 flex-1 rounded-[10px] border border-[var(--line)] px-2 text-[13px] text-[var(--text)] disabled:opacity-40";

function storage(): Storage | null {
  try { return localStorage; } catch { return null; }
}

export function RecipeList() {
  const { state, dispatch, sims, toast, asset } = useStudio();
  const [list, setList] = useState<Recipe[]>([]);
  const [nameSheet, setNameSheet] = useState<{ mode: "save" | "rename"; id?: string; value: string } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const st = storage();
    queueMicrotask(() => setList(st ? loadRecipes(st) : []));
  }, []);

  const persist = (next: Recipe[]) => {
    setList(next);
    const st = storage();
    if (!st || !saveRecipes(st, next)) toast("레시피를 저장하지 못했습니다. 브라우저의 사이트 데이터 저장이 허용되어 있는지 확인하세요");
  };

  const openSave = () => {
    if (list.length >= MAX_RECIPES) { toast("레시피는 최대 200개까지 저장할 수 있습니다"); return; }
    const ko = simRecipe(state.simId, sims).ko;
    setNameSheet({ mode: "save", value: defaultRecipeName(state.simId === null ? null : ko, new Date()) });
  };

  const commitName = () => {
    if (!nameSheet) return;
    const name = nameSheet.value.trim();
    if (Array.from(name).length < 1 || Array.from(name).length > 40) { toast("이름은 1~40자로 입력하세요"); return; }
    if (nameSheet.mode === "save") persist([...list, recipeFromState(state, name)]);
    else persist(list.map((r) => (r.id === nameSheet.id ? { ...r, name } : r)));
    setNameSheet(null);
  };

  const onImport = async (f: File | null) => {
    if (!f) return;
    const res = importRecipes(await f.text(), list);
    if (!res) { toast("레시피 파일 형식이 올바르지 않습니다. filmlab-recipes 로 내보낸 JSON 파일을 선택하세요"); return; }
    persist(res.recipes);
    toast(importToast(res));
  };

  const onExport = () => {
    const blob = new Blob([exportRecipes(list)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = exportFileName(new Date());
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button type="button" className={btn} disabled={!asset} onClick={openSave}>현재 설정 저장</button>
        <button type="button" className={btn} onClick={() => fileInput.current?.click()}>가져오기</button>
        <button type="button" className={btn} disabled={list.length === 0} onClick={onExport}>내보내기</button>
        <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { void onImport(e.target.files?.[0] ?? null); e.target.value = ""; }} />
      </div>
      {list.length === 0 ? <p className="py-4 text-center text-[13px] text-[var(--text-2)]">저장한 레시피가 없습니다</p> : null}
      <ul className="flex flex-col">
        {list.map((r) => (
          <li key={r.id} className="flex items-center border-b border-[var(--line)]">
            <button
              type="button" className="flex min-h-[52px] min-w-0 flex-1 flex-col items-start justify-center text-left"
              onClick={() => { dispatch({ type: "replace", state: applyRecipe(state, r) }); toast(`레시피 적용: ${r.name}`); }}
            >
              <span className="w-full truncate text-[14px]">{r.name}</span>
              <span className="text-[12px] text-[var(--text-2)]">{r.simId === null ? "필름 없음" : simRecipe(r.simId, sims).ko} · {r.createdAt.slice(0, 10)}</span>
            </button>
            <button type="button" aria-label="레시피 메뉴" className="flex h-11 w-11 items-center justify-center text-[var(--text-2)]" onClick={() => setMenu(r.id)}><IconMore /></button>
          </li>
        ))}
      </ul>
      <BottomSheet open={menu !== null} onClose={() => setMenu(null)} title="레시피" maxHeight="40dvh">
        <div className="flex flex-col">
          <button type="button" className="min-h-12 text-left text-[15px]" onClick={() => { const r = list.find((x) => x.id === menu); if (r) setNameSheet({ mode: "rename", id: r.id, value: r.name }); setMenu(null); }}>이름 변경</button>
          <button type="button" className="min-h-12 text-left text-[15px] text-[var(--danger)]" onClick={() => { persist(list.filter((x) => x.id !== menu)); setMenu(null); }}>삭제</button>
        </div>
      </BottomSheet>
      <BottomSheet open={nameSheet !== null} onClose={() => setNameSheet(null)} title={nameSheet?.mode === "save" ? "레시피 저장" : "이름 변경"} maxHeight="50dvh">
        <div className="flex flex-col gap-3">
          <input
            autoFocus value={nameSheet?.value ?? ""} maxLength={80} aria-label="레시피 이름"
            className="h-11 rounded-[10px] border border-[var(--line)] bg-[var(--panel-2)] px-3 text-[16px] text-[var(--text)] outline-none"
            onChange={(e) => setNameSheet((s) => (s ? { ...s, value: e.target.value } : s))} onKeyDown={(e) => { if (e.key === "Enter") commitName(); }}
          />
          <button type="button" className="h-11 rounded-[10px] bg-[var(--accent)] text-[14px] font-semibold text-[#0b0b0c]" onClick={commitName}>저장</button>
        </div>
      </BottomSheet>
    </div>
  );
}

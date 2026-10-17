// FSE-v2 필름 메타데이터 (id·brand·ko·en·mono). 배열 순서 = 탭 표시 순서.
// 색 파라미터의 SSOT 는 scripts/fse2-kernel.mjs 의 SIMS2 하나다(앱 번들에 들어가지 않음).
// 필름별 톤·질감(대비·하이라이트·그레인 등)은 src/lib/render/film-presets.ts 가 담당한다. LUT 에는 톤을 넣지 않는다(공통 T_ref).

/** @typedef {import("./engine.mjs").FilmSim} FilmSim */

/**
 * @template T
 * @param {T} o
 * @returns {T}
 */
function deepFreeze(o) {
  if (o !== null && typeof o === "object" && !Object.isFrozen(o)) {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

/** @type {ReadonlyArray<FilmSim>} */
export const FILM_SIMS = Object.freeze(/** @type {FilmSim[]} */ ([
  { id:'fuji-provia', brand:'fujifilm', ko:'프로비아', en:'PROVIA/Standard', mono:false },
  { id:'fuji-velvia', brand:'fujifilm', ko:'벨비아', en:'Velvia/Vivid', mono:false },
  { id:'fuji-astia', brand:'fujifilm', ko:'아스티아', en:'ASTIA/Soft', mono:false },
  { id:'fuji-classic-chrome', brand:'fujifilm', ko:'클래식 크롬', en:'Classic Chrome', mono:false },
  { id:'fuji-reala-ace', brand:'fujifilm', ko:'리얼라 에이스', en:'REALA ACE', mono:false },
  { id:'fuji-pro-neg-hi', brand:'fujifilm', ko:'프로 네거티브 하이', en:'PRO Neg. Hi', mono:false },
  { id:'fuji-pro-neg-std', brand:'fujifilm', ko:'프로 네거티브 스탠다드', en:'PRO Neg. Std', mono:false },
  { id:'fuji-classic-neg', brand:'fujifilm', ko:'클래식 네거티브', en:'Classic Neg.', mono:false },
  { id:'fuji-nostalgic-neg', brand:'fujifilm', ko:'노스탤직 네거티브', en:'Nostalgic Neg.', mono:false },
  { id:'fuji-eterna', brand:'fujifilm', ko:'이터나', en:'ETERNA/Cinema', mono:false },
  { id:'fuji-eterna-bleach-bypass', brand:'fujifilm', ko:'이터나 블리치 바이패스', en:'ETERNA Bleach Bypass', mono:false },
  { id:'fuji-acros', brand:'fujifilm', ko:'아크로스', en:'ACROS', mono:true },
  { id:'fuji-acros-ye', brand:'fujifilm', ko:'아크로스 +Ye', en:'ACROS+Ye', mono:true },
  { id:'fuji-acros-r', brand:'fujifilm', ko:'아크로스 +R', en:'ACROS+R', mono:true },
  { id:'fuji-acros-g', brand:'fujifilm', ko:'아크로스 +G', en:'ACROS+G', mono:true },
  { id:'fuji-monochrome', brand:'fujifilm', ko:'모노크롬', en:'Monochrome', mono:true },
  { id:'fuji-monochrome-ye', brand:'fujifilm', ko:'모노크롬 +Ye', en:'Monochrome+Ye', mono:true },
  { id:'fuji-monochrome-r', brand:'fujifilm', ko:'모노크롬 +R', en:'Monochrome+R', mono:true },
  { id:'fuji-monochrome-g', brand:'fujifilm', ko:'모노크롬 +G', en:'Monochrome+G', mono:true },
  { id:'fuji-sepia', brand:'fujifilm', ko:'세피아', en:'Sepia', mono:true },
  { id:'ricoh-standard', brand:'ricoh', ko:'스탠다드', en:'Standard', mono:false },
  { id:'ricoh-vivid', brand:'ricoh', ko:'비비드', en:'Vivid', mono:false },
  { id:'ricoh-positive-film', brand:'ricoh', ko:'포지티브 필름', en:'Positive Film', mono:false },
  { id:'ricoh-negative-film', brand:'ricoh', ko:'네거티브 필름', en:'Negative Film', mono:false },
  { id:'ricoh-bleach-bypass', brand:'ricoh', ko:'블리치 바이패스', en:'Bleach Bypass', mono:false },
  { id:'ricoh-retro', brand:'ricoh', ko:'레트로', en:'Retro', mono:false },
  { id:'ricoh-cross-process', brand:'ricoh', ko:'크로스 프로세스', en:'Cross Process', mono:false },
  { id:'ricoh-hdr-tone', brand:'ricoh', ko:'HDR 톤', en:'HDR Tone', mono:false },
  { id:'ricoh-monotone', brand:'ricoh', ko:'모노톤', en:'Monotone', mono:true },
  { id:'ricoh-soft-monotone', brand:'ricoh', ko:'소프트 모노톤', en:'Soft Monotone', mono:true },
  { id:'ricoh-hard-monotone', brand:'ricoh', ko:'하드 모노톤', en:'Hard Monotone', mono:true },
  { id:'ricoh-hi-contrast-bw', brand:'ricoh', ko:'하이 콘트라스트 흑백', en:'Hi-Contrast B&W', mono:true },
]).map(deepFreeze));

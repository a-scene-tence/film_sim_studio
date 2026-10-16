// FSE-v1 필름 파라미터 — 필름 룩을 바꾸는 유일한 경로 (CLAUDE.md §0).
// 배열 순서 = 탭 표시 순서. hue 행: [색상이동°, 채도배율, OKLab L 이동], 앵커 순서 red, orange, yellow, green, cyan, blue, purple, magenta.

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
  { id:'fuji-provia', brand:'fujifilm', ko:'프로비아', en:'PROVIA/Standard', mono:false, tone:{a:1.3,d:0.92,hdrMax:2.04,midOut:0.19}, sat:1, hue:[[0,1,0],[0,1,0],[0,1,0],[-2,1.02,0],[0,1,0],[0,1.04,0],[0,1,0],[0,1,0]], desat:[0.3,0.2], split:null, tint:null, fade:[0,1], shaderHints:{} },
  { id:'fuji-velvia', brand:'fujifilm', ko:'벨비아', en:'Velvia/Vivid', mono:false, tone:{a:1.55,d:0.9,hdrMax:2.04,midOut:0.175}, sat:1.18, hue:[[-3,1.12,-0.02],[-2,1.08,0],[0,1.1,0],[-4,1.15,-0.02],[4,1.1,-0.02],[4,1.15,-0.05],[0,1.1,0],[0,1.1,0]], desat:[0.25,0.1], split:null, tint:null, fade:[0,1], shaderHints:{} },
  { id:'fuji-astia', brand:'fujifilm', ko:'아스티아', en:'ASTIA/Soft', mono:false, tone:{a:1.22,d:0.94,hdrMax:2.04,midOut:0.195}, sat:1.06, hue:[[0,1.04,0],[1,0.98,0.01],[0,1,0],[-2,1.05,0],[0,1,0],[0,1.12,-0.02],[0,1,0],[0,1,0]], desat:[0.35,0.2], split:null, tint:null, fade:[0,1], shaderHints:{} },
  { id:'fuji-classic-chrome', brand:'fujifilm', ko:'클래식 크롬', en:'Classic Chrome', mono:false, tone:{a:1.42,d:0.95,hdrMax:2.2,midOut:0.175}, sat:0.8, hue:[[4,0.9,-0.02],[2,0.92,0],[-6,0.8,-0.02],[-10,0.72,-0.02],[0,0.85,0],[-10,0.8,0],[-6,0.8,0],[-4,0.82,0]], desat:[0.35,0.25], split:{shadow:[200,0.008],highlight:[75,0.006]}, tint:null, fade:[0,1], shaderHints:{} },
  { id:'fuji-reala-ace', brand:'fujifilm', ko:'리얼라 에이스', en:'REALA ACE', mono:false, tone:{a:1.42,d:0.93,hdrMax:2.04,midOut:0.185}, sat:1.04, hue:[[0,1.03,0],[0,1,0],[0,1,0],[-2,1.02,0],[0,1,0],[0,1.04,0],[0,1,0],[0,1,0]], desat:[0.25,0.15], split:null, tint:null, fade:[0,1], shaderHints:{} },
  { id:'fuji-pro-neg-hi', brand:'fujifilm', ko:'프로 네거티브 하이', en:'PRO Neg. Hi', mono:false, tone:{a:1.36,d:0.93,hdrMax:2.04,midOut:0.19}, sat:0.92, hue:[[2,0.95,0],[2,0.95,0.01],[0,0.95,0],[-2,0.92,0],[0,0.95,0],[0,1,0],[0,0.95,0],[0,0.95,0]], desat:[0.35,0.2], split:null, tint:null, fade:[0,1], shaderHints:{} },
  { id:'fuji-pro-neg-std', brand:'fujifilm', ko:'프로 네거티브 스탠다드', en:'PRO Neg. Std', mono:false, tone:{a:1.18,d:0.95,hdrMax:2.04,midOut:0.195}, sat:0.82, hue:[[3,0.88,0],[2,0.92,0.01],[0,0.85,0],[4,0.82,0],[0,0.88,0],[0,0.92,0],[0,0.85,0],[0,0.85,0]], desat:[0.35,0.25], split:{shadow:[190,0.006],highlight:[75,0]}, tint:null, fade:[0,1], shaderHints:{} },
  { id:'fuji-classic-neg', brand:'fujifilm', ko:'클래식 네거티브', en:'Classic Neg.', mono:false, tone:{a:1.48,d:0.94,hdrMax:2.1,midOut:0.18}, sat:0.88, hue:[[-6,1,-0.02],[-2,0.95,0],[-10,0.85,0],[14,0.8,-0.02],[4,0.85,0],[-8,0.85,-0.01],[0,0.85,0],[-4,0.95,0]], desat:[0.3,0.2], split:{shadow:[185,0.018],highlight:[70,0.012]}, tint:null, fade:[0,1], shaderHints:{} },
  { id:'fuji-nostalgic-neg', brand:'fujifilm', ko:'노스탤직 네거티브', en:'Nostalgic Neg.', mono:false, tone:{a:1.3,d:0.95,hdrMax:2.1,midOut:0.19}, sat:1.02, hue:[[3,1,0],[3,1.02,0],[-3,1,0],[-6,0.88,0],[0,0.9,0],[-4,0.92,0],[0,0.9,0],[0,0.95,0]], desat:[0.3,-0.1], split:{shadow:[40,0.004],highlight:[75,0.022]}, tint:null, fade:[0,1], shaderHints:{} },
  { id:'fuji-eterna', brand:'fujifilm', ko:'이터나', en:'ETERNA/Cinema', mono:false, tone:{a:1.12,d:0.96,hdrMax:2.3,midOut:0.185}, sat:0.7, hue:[[2,0.8,0],[2,0.85,0],[-4,0.75,0],[6,0.7,0],[0,0.8,0],[-6,0.82,0],[0,0.75,0],[0,0.75,0]], desat:[0.35,0.25], split:{shadow:[200,0.012],highlight:[80,0.006]}, tint:null, fade:[0.02,1], shaderHints:{} },
  { id:'fuji-eterna-bleach-bypass', brand:'fujifilm', ko:'이터나 블리치 바이패스', en:'ETERNA Bleach Bypass', mono:false, tone:{a:1.7,d:0.92,hdrMax:2.04,midOut:0.17}, sat:0.45, hue:[[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0]], desat:[0.4,0.3], split:{shadow:[210,0.006],highlight:[75,0]}, tint:null, fade:[0,1], shaderHints:{} },
  { id:'fuji-acros', brand:'fujifilm', ko:'아크로스', en:'ACROS', mono:true, tone:{a:1.45,d:0.93,hdrMax:2.1,midOut:0.18}, mixer:[0.2126,0.7152,0.0722], split:null, tint:null, fade:[0,1], shaderHints:{} },
  { id:'fuji-acros-ye', brand:'fujifilm', ko:'아크로스 +Ye', en:'ACROS+Ye', mono:true, tone:{a:1.45,d:0.93,hdrMax:2.1,midOut:0.18}, mixer:[0.32,0.64,0.04], split:null, tint:null, fade:[0,1], shaderHints:{} },
  { id:'fuji-acros-r', brand:'fujifilm', ko:'아크로스 +R', en:'ACROS+R', mono:true, tone:{a:1.45,d:0.93,hdrMax:2.1,midOut:0.18}, mixer:[0.52,0.44,0.04], split:null, tint:null, fade:[0,1], shaderHints:{} },
  { id:'fuji-acros-g', brand:'fujifilm', ko:'아크로스 +G', en:'ACROS+G', mono:true, tone:{a:1.45,d:0.93,hdrMax:2.1,midOut:0.18}, mixer:[0.16,0.78,0.06], split:null, tint:null, fade:[0,1], shaderHints:{} },
  { id:'fuji-monochrome', brand:'fujifilm', ko:'모노크롬', en:'Monochrome', mono:true, tone:{a:1.3,d:0.92,hdrMax:2.04,midOut:0.19}, mixer:[0.2126,0.7152,0.0722], split:null, tint:null, fade:[0,1], shaderHints:{} },
  { id:'fuji-monochrome-ye', brand:'fujifilm', ko:'모노크롬 +Ye', en:'Monochrome+Ye', mono:true, tone:{a:1.3,d:0.92,hdrMax:2.04,midOut:0.19}, mixer:[0.32,0.64,0.04], split:null, tint:null, fade:[0,1], shaderHints:{} },
  { id:'fuji-monochrome-r', brand:'fujifilm', ko:'모노크롬 +R', en:'Monochrome+R', mono:true, tone:{a:1.3,d:0.92,hdrMax:2.04,midOut:0.19}, mixer:[0.52,0.44,0.04], split:null, tint:null, fade:[0,1], shaderHints:{} },
  { id:'fuji-monochrome-g', brand:'fujifilm', ko:'모노크롬 +G', en:'Monochrome+G', mono:true, tone:{a:1.3,d:0.92,hdrMax:2.04,midOut:0.19}, mixer:[0.16,0.78,0.06], split:null, tint:null, fade:[0,1], shaderHints:{} },
  { id:'fuji-sepia', brand:'fujifilm', ko:'세피아', en:'Sepia', mono:true, tone:{a:1.3,d:0.92,hdrMax:2.04,midOut:0.19}, mixer:[0.2126,0.7152,0.0722], split:null, tint:[68,0.045], fade:[0,1], shaderHints:{} },
  { id:'ricoh-standard', brand:'ricoh', ko:'스탠다드', en:'Standard', mono:false, tone:{a:1.32,d:0.92,hdrMax:2.04,midOut:0.19}, sat:1.02, hue:[[0,1,0],[0,1,0],[0,1,0],[-2,1.02,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0]], desat:[0.3,0.2], split:null, tint:null, fade:[0,1], shaderHints:{} },
  { id:'ricoh-vivid', brand:'ricoh', ko:'비비드', en:'Vivid', mono:false, tone:{a:1.5,d:0.91,hdrMax:2.04,midOut:0.18}, sat:1.18, hue:[[0,1.08,0],[0,1.05,0],[0,1.08,0],[-2,1.1,0],[0,1.08,0],[0,1.1,-0.02],[0,1.05,0],[0,1.05,0]], desat:[0.25,0.1], split:null, tint:null, fade:[0,1], shaderHints:{} },
  { id:'ricoh-positive-film', brand:'ricoh', ko:'포지티브 필름', en:'Positive Film', mono:false, tone:{a:1.55,d:0.92,hdrMax:2.04,midOut:0.175}, sat:1.12, hue:[[2,1.1,-0.02],[2,1.05,0],[-4,1.05,0],[4,1,-0.02],[0,1.1,-0.02],[-6,1.15,-0.04],[0,1,0],[0,1,0]], desat:[0.25,0.1], split:{shadow:[230,0.01],highlight:[75,0.008]}, tint:null, fade:[0,1], shaderHints:{} },
  { id:'ricoh-negative-film', brand:'ricoh', ko:'네거티브 필름', en:'Negative Film', mono:false, tone:{a:1.1,d:0.96,hdrMax:2.1,midOut:0.19}, sat:0.8, hue:[[2,0.85,0],[2,0.92,0],[-4,0.85,0],[8,0.78,0],[0,0.85,0],[-6,0.85,0],[0,0.8,0],[0,0.85,0]], desat:[0.3,0.25], split:{shadow:[200,0.018],highlight:[70,0.01]}, tint:null, fade:[0.035,0.98], shaderHints:{} },
  { id:'ricoh-bleach-bypass', brand:'ricoh', ko:'블리치 바이패스', en:'Bleach Bypass', mono:false, tone:{a:1.75,d:0.92,hdrMax:2.04,midOut:0.165}, sat:0.4, hue:[[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0]], desat:[0.4,0.35], split:null, tint:null, fade:[0,1], shaderHints:{} },
  { id:'ricoh-retro', brand:'ricoh', ko:'레트로', en:'Retro', mono:false, tone:{a:1.15,d:0.95,hdrMax:2.04,midOut:0.19}, sat:0.62, hue:[[4,0.85,0],[0,1,0],[0,1,0],[-8,0.8,0],[0,1,0],[-6,0.75,0],[0,1,0],[0,1,0]], desat:[0.3,0.2], split:{shadow:[60,0.012],highlight:[85,0.035]}, tint:null, fade:[0.04,0.95], shaderHints:{vignette:-25} },
  { id:'ricoh-cross-process', brand:'ricoh', ko:'크로스 프로세스', en:'Cross Process', mono:false, tone:{a:1.6,d:0.92,hdrMax:2.04,midOut:0.185}, sat:1.15, hue:[[-6,1.1,0],[6,1,0],[6,1.15,0.02],[-10,1.1,0],[0,1,0],[-8,1.1,0],[0,1,0],[0,1.05,0]], desat:[0.25,0.1], split:{shadow:[250,0.03],highlight:[105,0.04]}, tint:null, fade:[0.02,1], shaderHints:{} },
  { id:'ricoh-hdr-tone', brand:'ricoh', ko:'HDR 톤', en:'HDR Tone', mono:false, tone:{a:1.05,d:0.97,hdrMax:2.04,midOut:0.2}, sat:1.18, hue:[[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0]], desat:[0.15,0], split:null, tint:null, fade:[0,1], shaderHints:{clarity:70,shadows:40,highlights:-50} },
  { id:'ricoh-monotone', brand:'ricoh', ko:'모노톤', en:'Monotone', mono:true, tone:{a:1.34,d:0.92,hdrMax:2.04,midOut:0.185}, mixer:[0.2126,0.7152,0.0722], split:null, tint:null, fade:[0,1], shaderHints:{} },
  { id:'ricoh-soft-monotone', brand:'ricoh', ko:'소프트 모노톤', en:'Soft Monotone', mono:true, tone:{a:1.05,d:0.96,hdrMax:2.04,midOut:0.2}, mixer:[0.2126,0.7152,0.0722], split:null, tint:null, fade:[0.03,0.97], shaderHints:{} },
  { id:'ricoh-hard-monotone', brand:'ricoh', ko:'하드 모노톤', en:'Hard Monotone', mono:true, tone:{a:1.75,d:0.9,hdrMax:2.04,midOut:0.17}, mixer:[0.2126,0.7152,0.0722], split:null, tint:null, fade:[0,1], shaderHints:{} },
  { id:'ricoh-hi-contrast-bw', brand:'ricoh', ko:'하이 콘트라스트 흑백', en:'Hi-Contrast B&W', mono:true, tone:{a:2.4,d:0.88,hdrMax:1.8,midOut:0.16}, mixer:[0.2126,0.7152,0.0722], split:null, tint:null, fade:[0,1], shaderHints:{grain:{amount:55,size:45},vignette:-45} },
]).map(deepFreeze));

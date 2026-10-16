// 섹션 10.4·10.5 재생 루프와 해상도 단계. 오디오·영상 동기는 <video> 가 맡고, 렌더러는 표시 프레임만 따라간다(재타이밍 금지).
export const TIERS = [1.0, 0.75, 0.5] as const;

interface FrameMeta { mediaTime: number; presentedFrames: number }
type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: FrameMeta) => void) => number;
  cancelVideoFrameCallback?: (h: number) => void;
};

export interface VideoStats { presentedFps: number; dropped: number; tier: number }

/**
 * 섹션 10.5 tier 규칙 (순수 로직): 최근 60 표시 프레임 동안 droppedVideoFrames 증가 > 2 이면 한 단계 낮추고,
 * 300 프레임 연속 증가 0 이고 tier < 1 이면 한 단계 높인다. 표시 프레임마다 누적 드롭 수로 호출한다.
 */
export class TierController {
  index = 0;
  private history: number[] = [];
  private zeroStreak = 0;
  private last = 0;

  get tier(): number { return TIERS[this.index]!; }

  /** 반환: tier 가 바뀌었으면 true */
  onFrame(dropped: number): boolean {
    this.history.push(dropped);
    if (this.history.length > 61) this.history.shift();
    if (dropped > this.last) this.zeroStreak = 0;
    else this.zeroStreak++;
    this.last = dropped;
    if (this.history.length >= 61 && dropped - this.history[0]! > 2 && this.index < TIERS.length - 1) {
      this.index++;
      this.history = [dropped];
      this.zeroStreak = 0;
      return true;
    }
    if (this.zeroStreak >= 300 && this.index > 0) {
      this.index--;
      this.zeroStreak = 0;
      this.history = [dropped];
      return true;
    }
    return false;
  }
}

export class VideoSource {
  readonly video: VideoWithRvfc;
  private url: string;
  private rvfcHandle: number | null = null;
  private rafHandle: number | null = null;
  private lastTime = -1;
  private disposed = false;
  private tiers = new TierController();
  private presentTimes: number[] = [];

  constructor(file: Blob, private fps: number, private onFrame: (mediaTime: number, frameIndex: number) => void, private onTier: (tier: number) => void) {
    this.url = URL.createObjectURL(file);
    const v = document.createElement("video") as VideoWithRvfc;
    v.playsInline = true;
    v.preload = "auto";
    v.muted = true;
    v.crossOrigin = "anonymous";
    // iOS Safari 는 문서에 붙지 않은 <video> 의 프레임 콜백·오디오 재생이 불안정하므로 보이지 않게 붙여 둔다
    v.setAttribute("aria-hidden", "true");
    v.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
    document.body.appendChild(v);
    this.video = v;
  }

  async load(timeoutMs = 10000): Promise<void> {
    const v = this.video;
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error("loadeddata 시간 초과")), timeoutMs);
      v.onloadeddata = () => { clearTimeout(t); res(); };
      v.onerror = () => { clearTimeout(t); rej(new Error(v.error?.message || "video 오류")); };
      v.src = this.url;
    });
    v.addEventListener("seeked", this.renderCurrent);
    v.addEventListener("pause", this.renderCurrent);
    this.startLoop();
  }

  get tier(): number { return this.tiers.tier; }

  frameIndexAt(mediaTime: number): number {
    return Math.round(mediaTime * this.fps);
  }

  private renderCurrent = () => {
    if (this.disposed) return;
    this.onFrame(this.video.currentTime, this.frameIndexAt(this.video.currentTime));
  };

  private startLoop(): void {
    const v = this.video;
    if (typeof v.requestVideoFrameCallback === "function") {
      const cb = (_now: number, meta: FrameMeta) => {
        if (this.disposed) return;
        this.onPresented();
        this.onFrame(meta.mediaTime, this.frameIndexAt(meta.mediaTime));
        this.rvfcHandle = v.requestVideoFrameCallback!(cb);
      };
      this.rvfcHandle = v.requestVideoFrameCallback(cb);
    } else {
      const tick = () => {
        if (this.disposed) return;
        if (v.currentTime !== this.lastTime) {
          this.lastTime = v.currentTime;
          this.onPresented();
          this.onFrame(v.currentTime, this.frameIndexAt(v.currentTime));
        }
        this.rafHandle = requestAnimationFrame(tick);
      };
      this.rafHandle = requestAnimationFrame(tick);
    }
  }

  /** 섹션 10.5 tier 조정 */
  private onPresented(): void {
    const now = performance.now();
    this.presentTimes.push(now);
    while (this.presentTimes.length && now - this.presentTimes[0]! > 1000) this.presentTimes.shift();
    if (this.video.paused) return;
    const q = this.video.getVideoPlaybackQuality?.();
    if (this.tiers.onFrame(q ? q.droppedVideoFrames : 0)) this.onTier(this.tier);
  }

  stats(): VideoStats {
    const q = this.video.getVideoPlaybackQuality?.();
    return { presentedFps: this.presentTimes.length, dropped: q ? q.droppedVideoFrames : 0, tier: this.tier };
  }

  /** 재생은 사용자 탭으로만. 재생 시 오디오를 낸다 */
  async play(): Promise<void> {
    this.video.muted = false;
    await this.video.play();
  }

  pause(): void {
    this.video.pause();
  }

  seek(t: number): void {
    this.video.currentTime = Math.max(0, Math.min(t, Number.isFinite(this.video.duration) ? this.video.duration : t));
  }

  dispose(): void {
    this.disposed = true;
    const v = this.video;
    if (this.rvfcHandle !== null) v.cancelVideoFrameCallback?.(this.rvfcHandle);
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    v.removeEventListener("seeked", this.renderCurrent);
    v.removeEventListener("pause", this.renderCurrent);
    v.pause();
    v.removeAttribute("src");
    v.load();
    v.remove();
    URL.revokeObjectURL(this.url);
  }
}

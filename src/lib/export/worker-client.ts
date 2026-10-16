// export.worker 호출 래퍼. 취소하면 worker.terminate() 를 부르고, 다음 사용 때 워커를 새로 만든다 (§10-4(3)).
import type { ExportRequest, ExportResponse } from "../../workers/export.worker";

export class ExportCancelled extends Error {
  constructor() { super("저장을 취소했습니다"); this.name = "ExportCancelled"; }
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type CallMessage = DistributiveOmit<ExportRequest, "id">;

export class ExportClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve(r: Extract<ExportResponse, { type: "done" }>): void; reject(e: Error): void; onProgress?: (v: number) => void }>();

  private get(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL("../../workers/export.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (ev: MessageEvent<ExportResponse>) => {
      const m = ev.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === "progress") { p.onProgress?.(m.value); return; }
      this.pending.delete(m.id);
      if (m.type === "error") p.reject(new Error(m.message));
      else p.resolve(m);
    };
    w.onerror = (ev) => {
      const err = new Error(`내보내기 워커 오류: ${ev.message || "알 수 없음"} — 페이지를 새로고침한 뒤 다시 시도하세요.`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.worker = null;
    };
    this.worker = w;
    return w;
  }

  call(msg: CallMessage, transfer: Transferable[] = [], onProgress?: (v: number) => void): Promise<Extract<ExportResponse, { type: "done" }>> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.get().postMessage({ ...msg, id }, transfer);
    });
  }

  /** 취소: 진행 중 호출을 모두 ExportCancelled 로 거절하고 워커를 종료한다 */
  cancel(): void {
    for (const p of this.pending.values()) p.reject(new ExportCancelled());
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

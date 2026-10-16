// Step 4 §12 결과 공유·다운로드 (사진·동영상 공통)

export function canShareFile(file: File): boolean {
  try {
    return typeof navigator !== "undefined" && typeof navigator.share === "function" && navigator.canShare?.({ files: [file] }) === true;
  } catch {
    return false;
  }
}

export type ShareOutcome = "shared" | "aborted" | "failed";

/** 사용자가 따로 탭했을 때만 호출한다 (인코딩 직후 자동 호출 금지: transient activation 이 사라진다). AbortError 는 무시 */
export async function shareFile(file: File): Promise<ShareOutcome> {
  try {
    await navigator.share({ files: [file], title: file.name });
    return "shared";
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return "aborted";
    return "failed";
  }
}

export const SHARE_FAILED_MSG = "공유하지 못했습니다. 파일 다운로드를 이용하세요.";
export const IOS_SHARE_HINT = "공유 → '이미지 저장' 또는 '비디오 저장' 을 누르면 사진 앱에 저장됩니다.";

/** a[download] 클릭, 60초 뒤 objectURL 해제 */
export function downloadBlob(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  const url = a.href;
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

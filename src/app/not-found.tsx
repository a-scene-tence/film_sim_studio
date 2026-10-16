export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#0b0b0c] px-6 text-center text-[#f2f2f2]">
      <p className="text-sm text-[#9a9aa0]">404</p>
      <h1 className="text-lg font-semibold">페이지를 찾을 수 없습니다</h1>
      {/* 서비스워커 navigate 경로로 전체 내비게이션을 하려고 Link 대신 <a> 를 쓴다 */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="rounded-full bg-[#ff6a1a] px-5 py-2.5 text-sm font-semibold text-[#0b0b0c]">
        스튜디오로 돌아가기
      </a>
    </main>
  );
}

// Step 4 §7-1 정적 스켈레톤: 배경 #0b0b0c, 가운데 "Film Lab" 로고 텍스트, 헤더·탭바 자리 회색 막대
export default function StudioSkeleton() {
  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: "#0b0b0c" }} aria-busy="true">
      <div style={{ height: 52, paddingTop: "env(safe-area-inset-top)", background: "#141416" }} />
      <div className="flex flex-1 items-center justify-center">
        <span style={{ color: "#f2f2f2", fontSize: 22, fontWeight: 700, letterSpacing: "0.02em" }}>Film Lab</span>
      </div>
      <div style={{ height: "calc(56px + env(safe-area-inset-bottom))", background: "#141416" }} />
    </div>
  );
}

// Step 4 §7-3 인라인 SVG 아이콘 (24×24 viewBox, stroke 1.75, currentColor)
import type { ReactNode } from "react";

export interface IconProps { size?: number; className?: string }

function Svg({ size = 22, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

export const IconOpen = (p: IconProps) => <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Svg>;
export const IconInfo = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="8" r="0.6" fill="currentColor" /></Svg>;
export const IconFilm = (p: IconProps) => <Svg {...p}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 3v18M16 3v18M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4" /></Svg>;
export const IconLight = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>;
export const IconColor = (p: IconProps) => <Svg {...p}><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4C21 6.7 17 3 12 3z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="15" cy="7.5" r="1" /></Svg>;
export const IconCurve = (p: IconProps) => <Svg {...p}><path d="M4 20V4M4 20h16" /><path d="M6 18c4 0 5-2 7-6s4-6 7-6" /></Svg>;
export const IconDetail = (p: IconProps) => <Svg {...p}><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></Svg>;
export const IconUndo = (p: IconProps) => <Svg {...p}><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></Svg>;
export const IconRedo = (p: IconProps) => <Svg {...p}><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></Svg>;
export const IconHistory = (p: IconProps) => <Svg {...p}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 7v5l3 2" /></Svg>;
export const IconPlay = (p: IconProps) => <Svg {...p}><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></Svg>;
export const IconPause = (p: IconProps) => <Svg {...p}><path d="M8 5v14M16 5v14" /></Svg>;
export const IconVolume = (p: IconProps) => <Svg {...p}><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16.5 8.5a5 5 0 0 1 0 7" /></Svg>;
export const IconMute = (p: IconProps) => <Svg {...p}><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M17 9l4 6M21 9l-4 6" /></Svg>;
export const IconClose = (p: IconProps) => <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>;
export const IconMore = (p: IconProps) => <Svg {...p}><circle cx="5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="19" cy="12" r="1.2" fill="currentColor" /></Svg>;
export const IconChevron = (p: IconProps) => <Svg {...p}><path d="M9 6l6 6-6 6" /></Svg>;
export const IconShare = (p: IconProps) => <Svg {...p}><path d="M12 15V3M8 7l4-4 4 4" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></Svg>;
export const IconDownload = (p: IconProps) => <Svg {...p}><path d="M12 3v12M8 11l4 4 4-4" /><path d="M5 19h14" /></Svg>;
export const IconVideo = (p: IconProps) => <Svg {...p}><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" /></Svg>;

/** 앱 아이콘 (스플래시·빈 상태 64px) — public/icons 와 같은 도안 */
export function AppMark({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#0b0b0c" stroke="#2a2a2e" />
      <circle cx="32" cy="32" r="17" fill="none" stroke="#f2f2f2" strokeWidth="4" />
      <circle cx="32" cy="32" r="10" fill="#e8e8e8" />
      <circle cx="46" cy="18" r="3.5" fill="#ff6a1a" />
    </svg>
  );
}

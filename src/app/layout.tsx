import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: 'Film Lab',
  description: 'FUJIFILM 20종 · RICOH GR 12종 필름 시뮬레이션. 모든 처리는 기기 안에서 이루어집니다.',
  applicationName: 'Film Lab',
  appleWebApp: { capable: true, title: 'Film Lab', statusBarStyle: 'black-translucent' },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#09090b',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        {/* Next 가 appleWebApp.capable 을 mobile-web-app-capable 로만 내보내므로 iOS 용 태그는 직접 명시 */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body className="min-h-full flex flex-col bg-[#0b0b0c] text-[#f2f2f2]">{children}</body>
    </html>
  );
}

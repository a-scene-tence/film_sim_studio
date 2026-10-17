import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Film Lab',
    short_name: 'Film Lab',
    description: 'FUJIFILM 20종 · RICOH GR 12종 필름 시뮬레이션. 모든 처리는 기기 안에서 이루어집니다.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'fullscreen'],
    orientation: 'portrait',
    background_color: '#09090b',
    theme_color: '#09090b',
    lang: 'ko',
    dir: 'ltr',
    categories: ['photo', 'utilities'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

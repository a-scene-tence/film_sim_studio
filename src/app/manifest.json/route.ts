import { buildManifest } from '@/lib/pwa/manifest-data';

export const dynamic = 'force-static';

/** 일부 모바일 브라우저 호환용: manifest.webmanifest 와 동일한 내용 */
export function GET(): Response {
  return new Response(JSON.stringify(buildManifest()), { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' } });
}

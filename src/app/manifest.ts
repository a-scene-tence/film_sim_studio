import type { MetadataRoute } from 'next';
import { buildManifest } from '@/lib/pwa/manifest-data';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return buildManifest();
}

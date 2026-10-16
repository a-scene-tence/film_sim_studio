'use client';
import dynamic from 'next/dynamic';
import StudioSkeleton from '@/components/studio/StudioSkeleton';

const Studio = dynamic(() => import('@/components/studio/Studio'), { ssr: false, loading: () => <StudioSkeleton /> });

export default function Page() {
  return <Studio />;
}

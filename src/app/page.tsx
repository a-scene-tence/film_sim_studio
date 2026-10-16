import Link from "next/link";
import { APP_NAME } from "@/config/app";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">{APP_NAME}</h1>
      <p className="text-sm text-neutral-400">Step 3 · WebGL2 렌더러</p>
      {[
        ["/lab/renderer", "렌더러 실험실 →"],
        ["/lab/media", "미디어 실험실 →"],
        ["/lab/luts", "LUT 실험실 →"],
      ].map(([href, label]) => (
        <Link
          key={href}
          href={href!}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-neutral-800 px-5 py-3 text-base font-medium active:bg-neutral-700"
        >
          {label}
        </Link>
      ))}
    </main>
  );
}

import type { NextConfig } from "next";
const isDev = process.env.NODE_ENV === "development";
const coi = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];
const nextConfig: NextConfig = {
  output: "export", images: { unoptimized: true }, reactStrictMode: true, trailingSlash: false,
  ...(isDev ? { async headers() { return [{ source: "/(.*)", headers: coi }]; } } : {}),
};
export default nextConfig;

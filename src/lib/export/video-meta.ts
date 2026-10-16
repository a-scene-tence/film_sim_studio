// Step 4 §7-6 동영상 미디어 정보: mediabunny Input.getMetadataTags() 와 오디오 트랙 정보. 메인 스레드 UI 에서 지연 로드한다.
export interface VideoMetaInfo {
  tags: Array<{ key: string; value: string }>;
  audio: { codec: string | null; channels: number | null; sampleRate: number | null } | null;
}

function show(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array) return `<${v.byteLength} bytes>`;
  try { return JSON.stringify(v); } catch { return String(v); }
}

export async function readVideoMetadata(file: Blob): Promise<VideoMetaInfo> {
  const { ALL_FORMATS, BlobSource, Input } = await import("mediabunny");
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const raw = (await input.getMetadataTags()) as Record<string, unknown>;
    const tags = Object.entries(raw).map(([key, value]) => ({ key, value: show(value) }));
    const at = await input.getPrimaryAudioTrack();
    const audio = at ? { codec: await at.getCodec(), channels: await at.getNumberOfChannels(), sampleRate: await at.getSampleRate() } : null;
    return { tags, audio };
  } finally {
    input.dispose();
  }
}

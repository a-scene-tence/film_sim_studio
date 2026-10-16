// 섹션 15.2-6: 섹션 4.2-8 조립 규칙대로 15개 프래그먼트 + 정점을 glslangValidator 로 컴파일한다.
// npm 이 실행 권한 없이 설치하는 경우(EACCES) os.tmpdir() 사본에 chmod 755 를 준 뒤 실행한다(사용자 승인 사항).
// 그래도 실행할 수 없으면(ENOENT, EACCES, 아키텍처 불일치) 사유를 출력하고 skip 한다.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleFragment, PASS_NAMES, VS_GLSL } from "../src/lib/render/glsl";

const dir = mkdtempSync(join(tmpdir(), "film-lab-glsl-"));

function resolveValidator(): { bin: string | null; reason: string } {
  let bin: string;
  try {
    const req = createRequire(import.meta.url);
    bin = (req("glslang-validator-prebuilt-predownloaded") as { path: string }).path;
  } catch (e) {
    return { bin: null, reason: `바이너리 경로 확인 실패: ${e instanceof Error ? e.message : String(e)}` };
  }
  const probe = (b: string) => spawnSync(b, ["--version"], { encoding: "utf8" });
  let r = probe(bin);
  if (r.error && (r.error as NodeJS.ErrnoException).code === "EACCES") {
    const copy = join(dir, "glslangValidator");
    try {
      copyFileSync(bin, copy);
      chmodSync(copy, 0o755);
      bin = copy;
      r = probe(bin);
    } catch (e) {
      return { bin: null, reason: `EACCES, 실행 권한 사본 생성 실패: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  if (r.error) return { bin: null, reason: `${(r.error as NodeJS.ErrnoException).code ?? ""} ${r.error.message}` };
  if (r.status !== 0) return { bin: null, reason: `--version 종료코드 ${r.status} (아키텍처 불일치 가능): ${r.stderr}` };
  return { bin, reason: "" };
}

const v = resolveValidator();
if (!v.bin) console.warn(`[render.shaders] glslangValidator 실행 불가 — skip: ${v.reason}`);

describe.skipIf(!v.bin)("섹션 15.2-6 GLSL ES 3.00 컴파일", () => {
  const compile = (file: string, stage: "frag" | "vert", src: string) => {
    const path = join(dir, file);
    writeFileSync(path, src);
    const r = spawnSync(v.bin as string, ["-S", stage, path], { encoding: "utf8" });
    expect(r.status, `${file}\n${r.stdout}${r.stderr}`).toBe(0);
  };
  it("정점 셰이더", () => compile("vs.vert", "vert", VS_GLSL));
  it("프래그먼트 15개", () => {
    expect(PASS_NAMES.length).toBe(15);
  });
  for (const p of PASS_NAMES) it(`fs_${p}`, () => compile(`fs_${p}.frag`, "frag", assembleFragment(p)));
});

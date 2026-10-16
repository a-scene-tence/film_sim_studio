import { describe, expect, it } from "vitest";
import { parseCube } from "@/lib/lut/parseCube";

function identityRows(N: number): string[] {
  const rows: string[] = [];
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
    rows.push(`${(r / (N - 1)).toFixed(6)} ${(g / (N - 1)).toFixed(6)} ${(b / (N - 1)).toFixed(6)}`);
  }
  return rows;
}

function expectIdentity(data: Float32Array, N: number, tol: number) {
  expect(data.length).toBe(N * N * N * 3);
  let o = 0;
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
    expect(Math.abs(data[o++]! - r / (N - 1))).toBeLessThanOrEqual(tol);
    expect(Math.abs(data[o++]! - g / (N - 1))).toBeLessThanOrEqual(tol);
    expect(Math.abs(data[o++]! - b / (N - 1))).toBeLessThanOrEqual(tol);
  }
}

describe("parseCube", () => {
  it("33³ 항등 → 항등 (±1e-6)", () => {
    const text = ["LUT_3D_SIZE 33", ...identityRows(33)].join("\n") + "\n";
    const { lut, errors } = parseCube(text);
    expect(errors).toEqual([]);
    expect(lut.size).toBe(33);
    expectIdentity(lut.data, 33, 1e-6);
    expect(lut.domainMin).toEqual([0, 0, 0]);
    expect(lut.domainMax).toEqual([1, 1, 1]);
  });

  it("CRLF, BOM, 주석, TITLE, DOMAIN, 비디오 범위 플래그, 알 수 없는 키워드", () => {
    const text =
      "﻿" +
      ["# 주석", 'TITLE "테스트 LUT"', "", "  # 들여쓴 주석", "DOMAIN_MIN 0.0 0.1 0.2", "DOMAIN_MAX 1.0 2.0 3.0", "LUT_IN_VIDEO_RANGE", "lut_out_video_range", "FOO_BAR 1", "LUT_3D_SIZE 2", ...identityRows(2)].join("\r\n") +
      "\r\n";
    const { lut, errors } = parseCube(text);
    expect(errors).toEqual([]);
    expect(lut.size).toBe(2);
    expect(lut.domainMin).toEqual([0, 0.1, 0.2]);
    expect(lut.domainMax).toEqual([1, 2, 3]);
    expect(lut.inVideoRange).toBe(true);
    expect(lut.outVideoRange).toBe(true);
    expect(lut.warnings).toContain("알 수 없는 키워드 무시: 9: FOO_BAR");
    expectIdentity(lut.data, 2, 1e-6);
  });

  it("LUT_3D_INPUT_RANGE 는 세 채널 동일 도메인", () => {
    const { lut, errors } = parseCube(["LUT_3D_SIZE 2", "LUT_3D_INPUT_RANGE -0.25 1.25", ...identityRows(2)].join("\n"));
    expect(errors).toEqual([]);
    expect(lut.domainMin).toEqual([-0.25, -0.25, -0.25]);
    expect(lut.domainMax).toEqual([1.25, 1.25, 1.25]);
  });

  it("행 수 부족 → 오류", () => {
    const rows = identityRows(4).slice(0, -1);
    const { errors } = parseCube(["LUT_3D_SIZE 4", ...rows].join("\n"));
    expect(errors.some((e) => e.startsWith("데이터 행 수 불일치: 기대 64, 실제 63"))).toBe(true);
  });

  it("NaN → 오류, 범위 밖 → 경고", () => {
    const rows = identityRows(2);
    rows[1] = "nan 0 0";
    rows[2] = "1.7 0 0";
    const { errors, lut } = parseCube(["LUT_3D_SIZE 2", ...rows].join("\n"));
    expect(errors.some((e) => e.includes("줄 3") && e.includes("NaN"))).toBe(true);
    expect(lut.warnings.some((w) => w.includes("줄 4"))).toBe(true);
  });

  it("1D(M=1024) + 3D(N=17) 셰이퍼 조합 → 33³ 로 굽기", () => {
    const M = 1024;
    const one: string[] = [];
    for (let i = 0; i < M; i++) {
      const v = Math.pow(i / (M - 1), 2).toFixed(6);
      one.push(`${v} ${v} ${v}`);
    }
    const text = ["LUT_1D_SIZE 1024", "LUT_3D_SIZE 17", ...one, ...identityRows(17)].join("\n");
    const { lut, errors } = parseCube(text);
    expect(errors).toEqual([]);
    expect(lut.size).toBe(33);
    let o = 0;
    for (let b = 0; b < 33; b++) for (let g = 0; g < 33; g++) for (let r = 0; r < 33; r++) {
      expect(Math.abs(lut.data[o++]! - (r / 32) ** 2)).toBeLessThanOrEqual(2e-6);
      expect(Math.abs(lut.data[o++]! - (g / 32) ** 2)).toBeLessThanOrEqual(2e-6);
      expect(Math.abs(lut.data[o++]! - (b / 32) ** 2)).toBeLessThanOrEqual(2e-6);
    }
  });

  it("1D 단독 → 33³ 로 굽기", () => {
    const { lut, errors } = parseCube(["LUT_1D_SIZE 2", "0 0 0", "1 1 1"].join("\n"));
    expect(errors).toEqual([]);
    expect(lut.size).toBe(33);
    expectIdentity(lut.data, 33, 1e-6);
  });

  it("LUT_3D_SIZE 66 거부", () => {
    const { errors, lut } = parseCube("LUT_3D_SIZE 66\n0 0 0\n");
    expect(errors.some((e) => e.includes("LUT_3D_SIZE") && e.includes("줄 1"))).toBe(true);
    expect(lut.size).toBe(0);
  });
});

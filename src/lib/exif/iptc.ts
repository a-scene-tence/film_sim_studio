import { concat, fromAscii, writeU16be, writeU32be } from "../media/binary";

/** IFD0 0x83BB 데이터를 Photoshop IRB 로 감싼다: "Photoshop 3.0\0" + "8BIM" + 0x0404 + 00 00 + u32 길이 + 데이터 + (홀수면 00) */
export function wrapIptcIrb(data: Uint8Array): Uint8Array {
  return concat([fromAscii("Photoshop 3.0\0"), fromAscii("8BIM"), writeU16be(0x0404), Uint8Array.of(0, 0), writeU32be(data.length), data, data.length & 1 ? Uint8Array.of(0) : new Uint8Array(0)]);
}

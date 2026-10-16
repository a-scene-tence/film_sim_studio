/** 13.5 XMP 의 Orientation 을 1 로, PixelX/YDimension 을 출력 크기로 치환한다 (정규식, UTF-8). */
export function patchXmp(xmp: Uint8Array, out: { width: number; height: number }): Uint8Array {
  let s = new TextDecoder("utf-8").decode(xmp);
  s = s
    .replace(/tiff:Orientation="\d+"/g, 'tiff:Orientation="1"')
    .replace(/<tiff:Orientation>\d+<\/tiff:Orientation>/g, "<tiff:Orientation>1</tiff:Orientation>")
    .replace(/exif:PixelXDimension="\d+"/g, `exif:PixelXDimension="${out.width}"`)
    .replace(/<exif:PixelXDimension>\d+<\/exif:PixelXDimension>/g, `<exif:PixelXDimension>${out.width}</exif:PixelXDimension>`)
    .replace(/exif:PixelYDimension="\d+"/g, `exif:PixelYDimension="${out.height}"`)
    .replace(/<exif:PixelYDimension>\d+<\/exif:PixelYDimension>/g, `<exif:PixelYDimension>${out.height}</exif:PixelYDimension>`);
  return new TextEncoder().encode(s);
}

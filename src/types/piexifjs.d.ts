declare module "piexifjs" {
  const piexif: {
    version: string;
    load(data: string): Record<string, unknown>;
    dump(exifObj: Record<string, unknown>): string;
    insert(exif: string, jpeg: string): string;
    remove(jpeg: string): string;
    TAGS: Record<string, Record<number, { name: string; type: string }>>;
    ImageIFD: Record<string, number>; ExifIFD: Record<string, number>; GPSIFD: Record<string, number>; InteropIFD: Record<string, number>;
  };
  export default piexif;
}

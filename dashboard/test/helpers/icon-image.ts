// Reads back what the icon code produces: a PNG decoded to pixels, and the icon
// SVG's canvas colour and bars. Written for the tests and independent of the
// encoder — its CRC-32 is its own table, not `zlib.crc32`.
import { inflateSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type Rgb = [number, number, number];

export interface DecodedPng {
  width: number;
  height: number;
  colorType: number;
  pixel(x: number, y: number): Rgb;
}

/** Decodes an 8-bit, non-interlaced RGB PNG with filter 0 only; throws on
 *  anything malformed (signature, chunk CRC, IEND, inflated length). */
export function decodePng(bytes: Uint8Array): DecodedPng {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((b, i) => bytes[i] === b)) throw new Error("png: bad signature");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  let header: { width: number; height: number; colorType: number } | undefined;
  const idat: Uint8Array[] = [];
  let ended = false;
  while (at < bytes.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...bytes.slice(at + 4, at + 8));
    const body = bytes.slice(at + 8, at + 8 + len);
    const crc = view.getUint32(at + 8 + len);
    if (crc32(bytes.slice(at + 4, at + 8 + len)) !== crc) throw new Error(`png: bad CRC in ${type}`);
    if (type === "IHDR") {
      const h = new DataView(body.buffer, body.byteOffset, body.byteLength);
      if (body[8] !== 8 || body[12] !== 0) throw new Error("png: not 8-bit non-interlaced");
      header = { width: h.getUint32(0), height: h.getUint32(4), colorType: body[9]! };
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") ended = true;
    at += 12 + len;
    if (ended) break;
  }
  if (!ended || at !== bytes.length) throw new Error("png: no IEND at the end");
  if (!header) throw new Error("png: no IHDR");
  if (header.colorType !== 2) throw new Error(`png: colour type ${header.colorType}, want 2 (RGB)`);
  const raw = inflateSync(Buffer.concat(idat));
  const { width, height } = header;
  if (raw.length !== height * (1 + 3 * width)) throw new Error("png: inflated length is wrong");
  const stride = 1 + 3 * width;
  for (let y = 0; y < height; y++) if (raw[y * stride] !== 0) throw new Error("png: filter is not 0");
  return {
    ...header,
    pixel: (x, y) => {
      const o = y * stride + 1 + x * 3;
      return [raw[o]!, raw[o + 1]!, raw[o + 2]!];
    },
  };
}

export interface IconBar {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  fill: string;
}

/** The canvas colour and the bars of an icon SVG, the bars in the icon's own
 *  64-unit coordinates (the group's translate/scale applied). */
export function readIconSvg(svg: string): { canvas: string; bars: IconBar[] } {
  const canvas = /<rect width="64" height="64" fill="(#[0-9A-Fa-f]{6})"\/>/.exec(svg);
  const g = /<g transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)">([\s\S]*)<\/g>/.exec(svg);
  if (!canvas || !g) throw new Error("icon svg: unexpected shape");
  const [tx, ty, scale] = [Number(g[1]), Number(g[2]), Number(g[3])];
  const rects = [
    ...g[4]!.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="[\d.]+" fill="(#[0-9A-Fa-f]{6})"\/>/g),
  ];
  return {
    canvas: canvas[1]!,
    bars: rects.map((m) => {
      const [x, y, w, h] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
      return { x0: x * scale + tx, y0: y * scale + ty, x1: (x + w) * scale + tx, y1: (y + h) * scale + ty, fill: m[5]! };
    }),
  };
}

export const hexRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;

/** The bounding box, in pixels, of everything that is not the canvas colour. */
export function coloredBox(png: DecodedPng, canvas: Rgb) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++) {
      const p = png.pixel(x, y);
      if (p.some((v, i) => v !== canvas[i])) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
      }
    }
  return { x0, y0, x1, y1 };
}

/** Each bar's centre pixel at the PNG's scale. */
export function barCentres(png: DecodedPng, bars: IconBar[]): Rgb[] {
  const k = png.width / 64;
  return bars.map((b) => png.pixel(Math.floor(((b.x0 + b.x1) / 2) * k), Math.floor(((b.y0 + b.y1) / 2) * k)));
}

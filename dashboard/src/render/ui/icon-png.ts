import { Buffer } from "node:buffer";
import { crc32, deflateSync } from "node:zlib";

/** Draws the icon SVG that `brand.ts`'s `icon()` returns at `size` × `size`
 *  pixels and returns it as an 8-bit RGB PNG. Understands exactly what `icon()`
 *  emits — the canvas rect, one translate/scale group, four rounded bars — and
 *  throws on anything else, so a change to the artwork's shape fails loudly
 *  rather than yielding a blank icon. No alpha channel: a maskable icon must be
 *  opaque. */
export function rasterizeIcon(svg: string, size: number): Buffer<ArrayBuffer> {
  const canvasRe = /<rect width="64" height="64" fill="(#[0-9A-Fa-f]{6})"\/>/;
  const groupRe = /<g transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)">/;
  const barRe = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="([\d.]+)" fill="(#[0-9A-Fa-f]{6})"\/>/g;
  const canvas = canvasRe.exec(svg);
  const group = groupRe.exec(svg);
  const bars = [...svg.matchAll(barRe)];
  const rest = svg.replace(canvasRe, "").replace(groupRe, "").replace("</g>", "").replace(barRe, "");
  if (!canvas || !group || bars.length !== 4 || !/^<svg [^>]*><\/svg>$/.test(rest)) {
    throw new Error("icon-png: the SVG is not the shape brand.ts's icon() emits");
  }
  const [tx, ty, scale] = [Number(group[1]), Number(group[2]), Number(group[3])];
  const k = size / 64;
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

  // Each bar as a pill in pixel space: centre, half-extents, corner radius.
  const pills = bars.map((m) => {
    const [x, y, w, h, rx] = [1, 2, 3, 4, 5].map((i) => Number(m[i]));
    const s = scale * k;
    return {
      cx: ((x! + w! / 2) * scale + tx) * k,
      cy: ((y! + h! / 2) * scale + ty) * k,
      hw: (w! / 2) * s,
      hh: (h! / 2) * s,
      r: rx! * s,
      color: rgb(m[6]!),
    };
  });

  const stride = 1 + 3 * size;
  const raw = Buffer.alloc(stride * size);
  const bg = rgb(canvas[1]!);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = [...bg];
      for (const p of pills) {
        // Signed distance from the pixel centre to the pill's edge, in pixels.
        const qx = Math.abs(x + 0.5 - p.cx) - (p.hw - p.r);
        const qy = Math.abs(y + 0.5 - p.cy) - (p.hh - p.r);
        const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - p.r;
        const cover = Math.min(Math.max(0.5 - d, 0), 1);
        for (let c = 0; c < 3; c++) px[c] = px[c]! * (1 - cover) + p.color[c]! * cover;
      }
      const o = y * stride + 1 + x * 3;
      raw[o] = Math.round(px[0]!);
      raw[o + 1] = Math.round(px[1]!);
      raw[o + 2] = Math.round(px[2]!);
    }
  }

  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.from(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]));
}

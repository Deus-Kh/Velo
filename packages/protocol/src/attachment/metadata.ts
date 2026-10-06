/**
 * Metadata stripping before encryption (T8.1, roadmap Phase 8': "strip
 * EXIF before encryption"). Pure byte-level, no decoder:
 *  - JPEG: EXIF is reduced to its orientation tag (needed to display camera
 *    pixels correctly); XMP, APP3–APP13, APP15 and COM segments are dropped.
 *    APP0 (JFIF), APP2 (ICC profile) and APP14 (Adobe colour transform) are
 *    kept because decoders need them for correct colours.
 *  - PNG: tEXt, zTXt, iTXt, eXIf and tIME chunks are dropped.
 *  - Anything else, or a malformed file, is returned unchanged.
 */
export type StripResult = { bytes: Uint8Array; removed: number; kind: 'jpeg' | 'png' | 'other' };

const JPEG_KEEP = new Set([0xe0, 0xe2, 0xee]);
const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function isJpeg(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

function isPng(b: Uint8Array): boolean {
  return b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;
}

function reducedExifOrientation(segment: Uint8Array): Uint8Array | null {
  const start = 4;
  if (segment.length < start + 14 || String.fromCharCode(...segment.subarray(start, start + 6)) !== 'Exif\0\0') return null;
  const tiff = start + 6;
  const little = segment[tiff] === 0x49 && segment[tiff + 1] === 0x49;
  if (!little && !(segment[tiff] === 0x4d && segment[tiff + 1] === 0x4d)) return null;
  const u16 = (at: number) => little ? segment[at]! | (segment[at + 1]! << 8) : (segment[at]! << 8) | segment[at + 1]!;
  const u32 = (at: number) => little
    ? (segment[at]! | (segment[at + 1]! << 8) | (segment[at + 2]! << 16) | (segment[at + 3]! << 24)) >>> 0
    : ((segment[at]! << 24) | (segment[at + 1]! << 16) | (segment[at + 2]! << 8) | segment[at + 3]!) >>> 0;
  if (u16(tiff + 2) !== 42) return null;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > segment.length) return null;
  const count = u16(ifd);
  for (let n = 0; n < count; n += 1) {
    const entry = ifd + 2 + n * 12;
    if (entry + 12 > segment.length || u16(entry) !== 0x0112 || u16(entry + 2) !== 3 || u32(entry + 4) !== 1) continue;
    const orientation = u16(entry + 8);
    if (orientation < 1 || orientation > 8) return null;
    const out = new Uint8Array(36);
    out.set([0xff, 0xe1, 0, out.length - 2, 0x45, 0x78, 0x69, 0x66, 0, 0], 0);
    const t = 10;
    out.set(little ? [0x49, 0x49] : [0x4d, 0x4d], t);
    if (little) {
      out.set([42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0], t + 2);
    } else {
      out.set([0, 42, 0, 0, 0, 8, 0, 0, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, orientation >> 8, orientation & 0xff, 0, 0, 0, 0, 0, 0], t + 2);
    }
    return out;
  }
  return null;
}

export function jpegOrientation(bytes: Uint8Array): number {
  if (!isJpeg(bytes)) return 1;
  let i = 2;
  while (i + 3 < bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1]!;
    if (marker === 0xda) break;
    if (marker >= 0xe0 && marker <= 0xef) {
      const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
      if (marker === 0xe1) {
        const reduced = reducedExifOrientation(bytes.subarray(i, i + 2 + length));
        if (reduced) {
          const little = reduced[10] === 0x49;
          return little ? reduced[28]! | (reduced[29]! << 8) : (reduced[28]! << 8) | reduced[29]!;
        }
      }
      i += 2 + length;
    } else {
      i += 2;
    }
  }
  return 1;
}

function stripJpeg(b: Uint8Array): StripResult {
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let removed = 0;
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return { bytes: b, removed: 0, kind: 'jpeg' }; // malformed: leave it alone
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (marker === 0xda) {
      parts.push(b.subarray(i)); // scan data through EOI: untouched
      i = b.length;
      break;
    }
    if (i + 3 >= b.length) return { bytes: b, removed: 0, kind: 'jpeg' };
    const segLen = (b[i + 2]! << 8) | b[i + 3]!;
    if (segLen < 2 || i + 2 + segLen > b.length) return { bytes: b, removed: 0, kind: 'jpeg' };
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const segment = b.subarray(i, i + 2 + segLen);
    const reducedExif = marker === 0xe1 ? reducedExifOrientation(segment) : null;
    const drop = (isApp && !JPEG_KEEP.has(marker)) || marker === 0xfe;
    if (reducedExif) {
      const unchanged = reducedExif.length === segment.length && reducedExif.every((value, index) => value === segment[index]);
      parts.push(unchanged ? segment : reducedExif);
      if (!unchanged) removed += 1;
    } else if (drop) removed += 1;
    else parts.push(segment);
    i += 2 + segLen;
  }
  if (removed === 0) return { bytes: b, removed: 0, kind: 'jpeg' };
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return { bytes: out, removed, kind: 'jpeg' };
}

function stripPng(b: Uint8Array): StripResult {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let removed = 0;
  let i = 8;
  while (i + 8 <= b.length) {
    const len = ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
    const type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    const end = i + 12 + len;
    if (end > b.length) return { bytes: b, removed: 0, kind: 'png' };
    if (PNG_DROP.has(type)) removed += 1;
    else parts.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  if (removed === 0) return { bytes: b, removed: 0, kind: 'png' };
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return { bytes: out, removed, kind: 'png' };
}

/** Never throws: an unknown or malformed file comes back unchanged. */
export function stripImageMetadata(bytes: Uint8Array): StripResult {
  if (isJpeg(bytes)) return stripJpeg(bytes);
  if (isPng(bytes)) return stripPng(bytes);
  return { bytes, removed: 0, kind: 'other' };
}

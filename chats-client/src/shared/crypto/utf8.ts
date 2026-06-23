export function utf8Encode(str: string): Uint8Array {
  const encoded = encodeURIComponent(str);
  const bytes: number[] = [];

  for (let i = 0; i < encoded.length; i++) {
    const c = encoded[i];
    if (c === '%') {
      bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(c.charCodeAt(0));
    }
  }

  return new Uint8Array(bytes);
}

export function utf8Decode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);

  try {
    // escape() is deprecated but works in RN and is sufficient here for typical chat text
    return decodeURIComponent(escape(s));
  } catch {
    return s;
  }
}

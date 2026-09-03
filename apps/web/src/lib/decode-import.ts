/** Decode uploads before parsing so UTF-16 MetaTrader reports retain non-ASCII symbols. */
export function decodeImportFile(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  const end = Math.min(bytes.length, 1024);
  let evenNuls = 0;
  let oddNuls = 0;
  for (let i = 0; i < end; i++) {
    if (bytes[i] === 0) i % 2 ? oddNuls++ : evenNuls++;
  }
  if (end > 20 && oddNuls > end / 5 && evenNuls < end / 20)
    return new TextDecoder("utf-16le").decode(bytes);
  if (end > 20 && evenNuls > end / 5 && oddNuls < end / 20)
    return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}

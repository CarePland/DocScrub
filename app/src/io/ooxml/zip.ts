/**
 * Production ZIP reader/writer for DocumentParser/DocumentRebuilder.
 *
 * A .docx is a ZIP archive of XML (and binary) parts. This implements just
 * enough of the ZIP format (central directory + local file headers, DEFLATE)
 * to read and write one, using ONLY browser-native Web APIs -- no npm
 * package.
 *
 * This supersedes spike/ooxml/zip.ts, which used Node's `node:zlib` as a
 * stand-in for `CompressionStream`/`DecompressionStream` because the spike
 * ran under Node. That stand-in is no longer necessary: `CompressionStream`
 * and `DecompressionStream` with format `"deflate-raw"` are themselves
 * available as Node 22 globals (confirmed directly in this environment --
 * `typeof CompressionStream === "function"` with no import), which are the
 * exact WHATWG Streams API the browser build will use. This module is
 * therefore not a prototype standing in for the real thing -- it IS the
 * real thing, verified against the real target API rather than an
 * approximation of it. See docs/ooxml-spike/phase-2-findings.md.
 *
 * Deliberately framed against Uint8Array/ArrayBuffer, not Node's Buffer, so
 * this code is identical whether it runs under Node (for fixture
 * verification, see verify/) or in a browser tab.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

// ---- CRC-32 (standard ZIP/PNG polynomial). Neither CompressionStream nor
// DecompressionStream exposes a CRC, and the ZIP format requires one in
// both the local file header and the central directory record. ------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i]!;
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---- Stream helpers -------------------------------------------------------

async function readAll(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

// `data` is typed as Uint8Array<ArrayBufferLike> at call sites (subarray()
// views over a buffer read from an ArrayBuffer can widen to
// ArrayBufferLike, which also covers SharedArrayBuffer). Streams' write()
// requires a BufferSource backed specifically by ArrayBuffer. Copying into
// a fresh Uint8Array guarantees that regardless of the input view's
// backing buffer -- cheap relative to the compression work itself, and
// avoids a type assertion that could silently paper over an actual
// SharedArrayBuffer at runtime.
function toArrayBufferBacked(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return copy;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  // Fire-and-forget write/close; readAll() below drives consumption of the
  // readable side, which is what actually pumps the stream to completion.
  void writer.write(toArrayBufferBacked(data)).then(() => writer.close());
  return readAll(cs.readable);
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  void writer.write(toArrayBufferBacked(data)).then(() => writer.close());
  return readAll(ds.readable);
}

// ---- Reading ---------------------------------------------------------------

export async function readZip(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error("Not a valid ZIP: End Of Central Directory record not found");
  }

  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);

  const parts = new Map<string, Uint8Array>();
  let cursor = centralDirOffset;
  const decoder = new TextDecoder("utf-8");

  for (let i = 0; i < entryCount; i++) {
    const signature = view.getUint32(cursor, true);
    if (signature !== CENTRAL_DIR_SIGNATURE) {
      throw new Error(`Expected central directory signature at offset ${cursor}, entry ${i}`);
    }
    const compressionMethod = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraFieldLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + fileNameLength));

    const data = await readLocalEntry(bytes, view, localHeaderOffset, compressionMethod, compressedSize);
    parts.set(name, data);

    cursor += 46 + fileNameLength + extraFieldLength + commentLength;
  }

  return parts;
}

async function readLocalEntry(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  compressionMethod: number,
  compressedSize: number
): Promise<Uint8Array> {
  const signature = view.getUint32(offset, true);
  if (signature !== LOCAL_FILE_SIGNATURE) {
    throw new Error(`Expected local file header signature at offset ${offset}`);
  }
  const fileNameLength = view.getUint16(offset + 26, true);
  const extraFieldLength = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + fileNameLength + extraFieldLength;
  const raw = bytes.subarray(dataStart, dataStart + compressedSize);

  if (compressionMethod === 0) {
    return new Uint8Array(raw); // stored, no compression
  }
  if (compressionMethod === 8) {
    return inflateRaw(raw);
  }
  throw new Error(`Unsupported ZIP compression method ${compressionMethod} (only stored=0 and deflate=8 handled)`);
}

// ---- Writing ----------------------------------------------------------------

function dosDateTime(): { date: number; time: number } {
  // Fixed, arbitrary timestamp. Word does not care about ZIP entry
  // timestamps; a real implementation deliberately avoids embedding the
  // actual current time here to keep rebuild output byte-reproducible for
  // identical input, which fixture-diffing benefits from.
  return { date: 0x0021, time: 0x0000 };
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export async function writeZip(entries: ZipEntry[]): Promise<Uint8Array> {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;
  const { date, time } = dosDateTime();
  const encoder = new TextEncoder();

  for (const entry of entries) {
    const nameBuf = encoder.encode(entry.name);
    const compressed = await deflateRaw(entry.data);
    const crc = crc32(entry.data);

    const localHeader = new DataView(new ArrayBuffer(30));
    localHeader.setUint32(0, LOCAL_FILE_SIGNATURE, true);
    localHeader.setUint16(4, 20, true); // version needed
    localHeader.setUint16(6, 0, true); // flags
    localHeader.setUint16(8, 8, true); // compression: deflate
    localHeader.setUint16(10, time, true);
    localHeader.setUint16(12, date, true);
    localHeader.setUint32(14, crc, true);
    localHeader.setUint32(18, compressed.length, true);
    localHeader.setUint32(22, entry.data.length, true);
    localHeader.setUint16(26, nameBuf.length, true);
    localHeader.setUint16(28, 0, true); // extra field length

    localChunks.push(new Uint8Array(localHeader.buffer), nameBuf, compressed);

    const centralHeader = new DataView(new ArrayBuffer(46));
    centralHeader.setUint32(0, CENTRAL_DIR_SIGNATURE, true);
    centralHeader.setUint16(4, 20, true); // version made by
    centralHeader.setUint16(6, 20, true); // version needed
    centralHeader.setUint16(8, 0, true); // flags
    centralHeader.setUint16(10, 8, true); // compression: deflate
    centralHeader.setUint16(12, time, true);
    centralHeader.setUint16(14, date, true);
    centralHeader.setUint32(16, crc, true);
    centralHeader.setUint32(20, compressed.length, true);
    centralHeader.setUint32(24, entry.data.length, true);
    centralHeader.setUint16(28, nameBuf.length, true);
    centralHeader.setUint16(30, 0, true); // extra field length
    centralHeader.setUint16(32, 0, true); // comment length
    centralHeader.setUint16(34, 0, true); // disk number
    centralHeader.setUint16(36, 0, true); // internal attrs
    centralHeader.setUint32(38, 0, true); // external attrs
    centralHeader.setUint32(42, offset, true); // offset of local header

    centralChunks.push(new Uint8Array(centralHeader.buffer), nameBuf);

    offset += 30 + nameBuf.length + compressed.length;
  }

  const centralDirStart = offset;
  const centralDirBuf = concatBytes(centralChunks);

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, EOCD_SIGNATURE, true);
  eocd.setUint16(4, 0, true); // disk number
  eocd.setUint16(6, 0, true); // disk with central dir
  eocd.setUint16(8, entries.length, true); // entries on this disk
  eocd.setUint16(10, entries.length, true); // total entries
  eocd.setUint32(12, centralDirBuf.length, true);
  eocd.setUint32(16, centralDirStart, true);
  eocd.setUint16(20, 0, true); // comment length

  return concatBytes([...localChunks, centralDirBuf, new Uint8Array(eocd.buffer)]);
}

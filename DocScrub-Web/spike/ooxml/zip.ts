/**
 * Phase 2 OOXML spike -- zero-dependency ZIP reader/writer.
 *
 * A .docx is a ZIP archive of XML parts. This implements just enough of the
 * ZIP format (central directory + local file headers, DEFLATE via Node's
 * built-in zlib) to read and write one, without any npm package.
 *
 * Why this exists: the sandbox this spike was built in has no npm registry
 * access (see ../../README.md, "Environment constraints"), so a library
 * like `jszip` or `pizzip` could not be installed to prove feasibility.
 * Node's `zlib.inflateRawSync`/`deflateRawSync` implement the same raw
 * DEFLATE algorithm as the browser's native `CompressionStream`/
 * `DecompressionStream` with format `"deflate-raw"` -- so this is a
 * legitimate stand-in for prototyping, not a hack: the real browser
 * DocumentParser/DocumentRebuilder can use CompressionStream/
 * DecompressionStream directly, with the ZIP central-directory parsing
 * logic below translated essentially line-for-line (it's plain binary
 * struct parsing, nothing Node-specific about the format itself).
 *
 * See ../../docs/ooxml-spike/phase-2-findings.md for what this did and did
 * not prove.
 */

import { deflateRawSync, inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

export interface ZipEntry {
  name: string;
  data: Buffer;
}

// ---- CRC-32 (standard ZIP/PNG polynomial), implemented directly since
// Node's zlib does not expose a public crc32 function. -----------------

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

export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i]!;
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---- Reading ------------------------------------------------------------

export function readZip(buffer: Buffer): Map<string, Buffer> {
  // Find End Of Central Directory record by scanning backward for its
  // signature (it can be followed by a variable-length comment field).
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error("Not a valid ZIP: End Of Central Directory record not found");
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  const parts = new Map<string, Buffer>();
  let cursor = centralDirOffset;

  for (let i = 0; i < entryCount; i++) {
    const signature = buffer.readUInt32LE(cursor);
    if (signature !== CENTRAL_DIR_SIGNATURE) {
      throw new Error(`Expected central directory signature at offset ${cursor}, entry ${i}`);
    }
    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraFieldLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + fileNameLength);

    const data = readLocalEntry(buffer, localHeaderOffset, compressionMethod, compressedSize);
    parts.set(name, data);

    cursor += 46 + fileNameLength + extraFieldLength + commentLength;
  }

  return parts;
}

function readLocalEntry(buffer: Buffer, offset: number, compressionMethod: number, compressedSize: number): Buffer {
  const signature = buffer.readUInt32LE(offset);
  if (signature !== LOCAL_FILE_SIGNATURE) {
    throw new Error(`Expected local file header signature at offset ${offset}`);
  }
  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraFieldLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraFieldLength;
  const raw = buffer.subarray(dataStart, dataStart + compressedSize);

  if (compressionMethod === 0) {
    return Buffer.from(raw); // stored, no compression
  }
  if (compressionMethod === 8) {
    return inflateRawSync(raw);
  }
  throw new Error(`Unsupported ZIP compression method ${compressionMethod} (only stored=0 and deflate=8 handled)`);
}

// ---- Writing --------------------------------------------------------------

function dosDateTime(): { date: number; time: number } {
  // Fixed, arbitrary timestamp -- acceptable for a spike; a real
  // implementation would use the current date. Word does not care.
  return { date: 0x0021, time: 0x0000 };
}

export function writeZip(entries: ZipEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;
  const { date, time } = dosDateTime();

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(LOCAL_FILE_SIGNATURE, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(8, 8); // compression: deflate
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    localChunks.push(localHeader, nameBuf, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(CENTRAL_DIR_SIGNATURE, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(8, 10); // compression: deflate
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra field length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // offset of local header

    centralChunks.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDirStart = offset;
  const centralDirBuf = Buffer.concat(centralChunks);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(centralDirStart, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localChunks, centralDirBuf, eocd]);
}

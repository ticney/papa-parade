// A .glb is a small container: 12-byte header, then chunks (JSON, optional BIN). No dependency.

const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_VERSION = 2;
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

/** The file is not a valid .glb (bad magic, version, length or chunk). */
export class GlbError extends Error {
  override readonly name = 'GlbError';
}

export interface GlbContents {
  json: unknown;
  /** The binary chunk, or null when the file has none. */
  bin: Uint8Array | null;
}

/** Splits a .glb into its JSON and BIN chunks. Throws a {@link GlbError} that says what is wrong. */
export function parseGlb(bytes: Uint8Array): GlbContents {
  if (bytes.byteLength < HEADER_BYTES) throw new GlbError('not a .glb: file shorter than a header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC)
    throw new GlbError('not a .glb: bad magic (expected "glTF")');
  const version = view.getUint32(4, true);
  if (version !== GLB_VERSION)
    throw new GlbError(`unsupported .glb version ${version} (expected 2)`);
  const declared = view.getUint32(8, true);
  if (declared !== bytes.byteLength) {
    throw new GlbError(`bad .glb length: header says ${declared}, file has ${bytes.byteLength}`);
  }

  let json: unknown;
  let hasJson = false;
  let bin: Uint8Array | null = null;
  let offset = HEADER_BYTES;
  while (offset < bytes.byteLength) {
    if (offset + CHUNK_HEADER_BYTES > bytes.byteLength)
      throw new GlbError('truncated chunk header');
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + CHUNK_HEADER_BYTES;
    if (start + length > bytes.byteLength)
      throw new GlbError('chunk runs past the end of the file');
    const body = bytes.subarray(start, start + length);
    if (type === CHUNK_JSON && !hasJson) {
      try {
        json = JSON.parse(new TextDecoder().decode(body));
      } catch (cause) {
        throw new GlbError(
          `JSON chunk is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
      hasJson = true;
    } else if (type === CHUNK_BIN && bin === null) {
      bin = body;
    }
    // Any other chunk type is ignored, as the spec asks.
    offset = start + length;
  }
  if (!hasJson) throw new GlbError('.glb has no JSON chunk');
  return { json, bin };
}

const pad4 = (length: number): number => (length + 3) & ~3;

/** Builds a .glb from a JSON document and an optional binary chunk (tests build their input with it). */
export function buildGlb(json: unknown, bin?: Uint8Array): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = pad4(jsonBytes.byteLength);
  const binLength = bin === undefined ? 0 : pad4(bin.byteLength);
  const total =
    HEADER_BYTES +
    CHUNK_HEADER_BYTES +
    jsonLength +
    (bin === undefined ? 0 : CHUNK_HEADER_BYTES + binLength);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, GLB_VERSION, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.fill(0x20, 20, 20 + jsonLength); // JSON is padded with spaces
  out.set(jsonBytes, 20);
  if (bin !== undefined) {
    const at = 20 + jsonLength;
    view.setUint32(at, binLength, true);
    view.setUint32(at + 4, CHUNK_BIN, true);
    out.set(bin, at + CHUNK_HEADER_BYTES);
  }
  return out;
}

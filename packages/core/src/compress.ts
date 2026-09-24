/**
 * deflate-raw via the web-standard Compression Streams API, which Node 24 and
 * every current browser implement. No dependency, and identical bytes on both
 * sides — which matters, because a payload encoded on a phone has to decode on
 * a receptionist's desktop.
 *
 * Raw deflate (no zlib or gzip wrapper) saves the header bytes. At payloads of
 * ~150 characters those bytes are a visible fraction of the QR's size.
 */

async function pipe(bytes: Uint8Array, transform: TransformStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new CompressionStream('deflate-raw'));
}

/**
 * `maxBytes` bounds the decompressed result. Compressed input is already capped
 * upstream by the maximum payload length, which keeps the worst-case expansion
 * small enough to inflate before checking.
 */
export async function inflateRaw(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const out = await pipe(bytes, new DecompressionStream('deflate-raw'));
  if (out.length > maxBytes) throw new Error('decompressed body exceeds expected size');
  return out;
}

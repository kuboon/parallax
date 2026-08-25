/**
 * Writing a depth map into a JPEG, the way Google's camera app does.
 *
 * The format is `GDepth`: a handful of XMP properties describing the map, plus the map itself
 * base64-encoded into `GDepth:Data`. That value is far larger than the 64 KiB a JPEG marker segment
 * holds, so XMP's Extended mechanism splits it across as many `APP1` segments as it takes and keys
 * them by the MD5 of the whole serialisation, which the standard packet then names in
 * `xmpNote:HasExtendedXMP`.
 *
 * This is the format the "3D photo" generation of tools read, and it is the only way to hand a
 * viewer a depth map inside a single file. Whether any given site still looks for it is exactly
 * what this simulator exists to find out — which is why the pair of separate files stays the
 * primary export and this one is offered beside it.
 */

import { md5Hex } from "./md5.ts";

/** Segment marker for `APP1`, where both XMP packets live. */
const APP1 = 0xe1;

/** Segment marker for `APP0`, the JFIF header a canvas-encoded JPEG starts with. */
const APP0 = 0xe0;

/** A marker segment's length field counts itself, so this is the most a payload can be. */
const MAX_PAYLOAD = 65533;

/** Namespace prefix identifying the standard XMP packet. */
const XMP_HEADER = "http://ns.adobe.com/xap/1.0/\0";

/** Namespace prefix identifying an Extended XMP chunk. */
const XMP_EXTENSION_HEADER = "http://ns.adobe.com/xmp/extension/\0";

/** Each chunk carries the 32-character GUID, a total length and an offset ahead of its data. */
const EXTENSION_OVERHEAD = XMP_EXTENSION_HEADER.length + 32 + 4 + 4;

/** How a depth map's byte values map onto distance. */
export type DepthFormat = "RangeInverse" | "RangeLinear";

/** What the XMP says about the depth map being attached. */
export interface DepthMapMeta {
  /** Encoding of the attached map. */
  mime: "image/png" | "image/jpeg";
  /** How byte values map onto distance. */
  format?: DepthFormat;
  /** Distance of the nearest surface, in metres. */
  near?: number;
  /** Distance of the farthest surface, in metres. */
  far?: number;
}

/**
 * Writes a depth map into a JPEG as `GDepth` XMP.
 *
 * @param jpeg The colour image, as encoded JPEG bytes
 * @param depth The depth map, as encoded PNG or JPEG bytes
 * @param meta What to say about the depth map
 * @returns A new JPEG carrying both
 */
export function embedDepthMap(
  jpeg: Uint8Array,
  depth: Uint8Array,
  meta: DepthMapMeta,
): Uint8Array {
  const extended = extendedPacket(depth.toBase64());
  const extendedBytes = new TextEncoder().encode(extended);
  const guid = md5Hex(extendedBytes).toUpperCase();

  const segments = [
    app1(concat(encode(XMP_HEADER), encode(standardPacket(meta, guid)))),
    ...extendedSegments(extendedBytes, guid),
  ];

  const at = insertionPoint(jpeg);
  return concat(jpeg.subarray(0, at), ...segments, jpeg.subarray(at));
}

/** The standard XMP packet: everything about the depth map except the map. */
function standardPacket(meta: DepthMapMeta, guid: string): string {
  const format = meta.format ?? "RangeLinear";
  // A plausible near-to-far span in metres. Zero is not one: a reader that turns these into
  // distances has a degenerate range to work with, and `RangeInverse` divides by it outright.
  const near = meta.near ?? 0.1;
  const far = meta.far ?? 10;

  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:GDepth="http://ns.google.com/photos/1.0/depthmap/"
    xmlns:xmpNote="http://ns.adobe.com/xmp/note/"
    GDepth:Format="${format}"
    GDepth:Near="${near}"
    GDepth:Far="${far}"
    GDepth:Mime="${meta.mime}"
    xmpNote:HasExtendedXMP="${guid}"/>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/** The extended XMP packet: the map itself, and nothing else. */
function extendedPacket(base64: string): string {
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:GDepth="http://ns.google.com/photos/1.0/depthmap/"
    GDepth:Data="${base64}"/>
 </rdf:RDF>
</x:xmpmeta>`;
}

/** Splits the extended packet across as many `APP1` segments as it takes. */
function extendedSegments(packet: Uint8Array, guid: string): Uint8Array[] {
  const chunkSize = MAX_PAYLOAD - EXTENSION_OVERHEAD;
  const segments: Uint8Array[] = [];

  for (let offset = 0; offset < packet.length; offset += chunkSize) {
    const chunk = packet.subarray(offset, offset + chunkSize);
    const header = new Uint8Array(EXTENSION_OVERHEAD);
    header.set(encode(XMP_EXTENSION_HEADER));
    header.set(encode(guid), XMP_EXTENSION_HEADER.length);

    const view = new DataView(header.buffer);
    view.setUint32(XMP_EXTENSION_HEADER.length + 32, packet.length);
    view.setUint32(XMP_EXTENSION_HEADER.length + 36, offset);

    segments.push(app1(concat(header, chunk)));
  }

  return segments;
}

/** Wraps a payload in an `APP1` marker segment. */
function app1(payload: Uint8Array): Uint8Array {
  if (payload.length > MAX_PAYLOAD) {
    throw new Error(
      `APP1 payload of ${payload.length} bytes exceeds ${MAX_PAYLOAD}.`,
    );
  }

  const segment = new Uint8Array(payload.length + 4);
  segment[0] = 0xff;
  segment[1] = APP1;
  segment[2] = (payload.length + 2) >> 8;
  segment[3] = (payload.length + 2) & 0xff;
  segment.set(payload, 4);
  return segment;
}

/**
 * Where the new segments go: after the JFIF header, ahead of everything else.
 *
 * XMP wants to be near the front of the file, and stepping over the `APP0` a canvas-encoded JPEG
 * opens with is enough to get there without disturbing anything a decoder reads first.
 */
function insertionPoint(jpeg: Uint8Array): number {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new Error("Not a JPEG: the file does not start with SOI.");
  }

  let pos = 2;
  while (
    pos + 4 <= jpeg.length && jpeg[pos] === 0xff && jpeg[pos + 1] === APP0
  ) {
    pos += 2 + ((jpeg[pos + 2] << 8) | jpeg[pos + 3]);
  }

  return pos;
}

/**
 * Reads back every `APP1` payload in a JPEG.
 *
 * Only the tests need this — but a writer nobody ever reads back is a writer nobody has checked.
 *
 * @param jpeg JPEG bytes
 * @returns One entry per `APP1` segment, in file order
 */
export function app1Payloads(jpeg: Uint8Array): Uint8Array[] {
  const found: Uint8Array[] = [];
  let pos = 2;

  while (pos + 4 <= jpeg.length && jpeg[pos] === 0xff) {
    const marker = jpeg[pos + 1];
    // Start of scan: entropy-coded data follows, which is not marker-structured.
    if (marker === 0xda) break;

    const length = (jpeg[pos + 2] << 8) | jpeg[pos + 3];
    if (marker === APP1) found.push(jpeg.subarray(pos + 4, pos + 2 + length));
    pos += 2 + length;
  }

  return found;
}

/** UTF-8 encodes a string. */
function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Joins byte arrays into one. */
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

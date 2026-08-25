import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";

import { app1Payloads, embedDepthMap } from "./jpeg-xmp.ts";
import { md5Hex } from "./md5.ts";

/** A JPEG shell: SOI, a JFIF `APP0`, then a start-of-scan the walker must stop at. */
function jpegShell(): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    0xda,
    0x00,
    0x02,
    0x12,
    0x34,
    0x56,
    0xff,
    0xd9,
  ]);
}

const decoder = new TextDecoder();

Deno.test("md5 matches the published test vectors", () => {
  const digest = (text: string) => md5Hex(new TextEncoder().encode(text));

  assertEquals(digest(""), "d41d8cd98f00b204e9800998ecf8427e");
  assertEquals(digest("abc"), "900150983cd24fb0d6963f7d28e17f72");
  assertEquals(digest("message digest"), "f96b697d7cb7938d525a2f31aaf161d0");
  assertEquals(
    digest(
      "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
    ),
    "57edf4a22be3c955ac49da2e2107b67a",
  );
  assertEquals(digest("a".repeat(64)), "014842d480b571495a4a0363793f7367");
});

Deno.test("the depth map survives the round trip through XMP", () => {
  // Large enough to need several chunks, and not compressible into an accidental match.
  const depth = new Uint8Array(200_000);
  for (let i = 0; i < depth.length; i++) depth[i] = (i * 37 + (i >> 8)) & 0xff;

  const jpeg = embedDepthMap(jpegShell(), depth, { mime: "image/png" });
  const payloads = app1Payloads(jpeg);

  const standard = decoder.decode(payloads[0]);
  assertStringIncludes(standard, "http://ns.adobe.com/xap/1.0/\0");
  assertStringIncludes(standard, 'GDepth:Mime="image/png"');

  const guid = standard.match(/xmpNote:HasExtendedXMP="([0-9A-F]{32})"/)?.[1];
  assertEquals(typeof guid, "string");

  const chunks = payloads.slice(1);
  assertEquals(
    chunks.length > 1,
    true,
    "a 200 KB map should not fit in one segment",
  );

  // Every chunk names the same GUID and total length, and declares where it belongs.
  const header = "http://ns.adobe.com/xmp/extension/\0".length;
  const total = new DataView(chunks[0].buffer, chunks[0].byteOffset).getUint32(
    header + 32,
  );
  const packet = new Uint8Array(total);
  let seen = 0;

  for (const chunk of chunks) {
    const view = new DataView(chunk.buffer, chunk.byteOffset);
    assertEquals(
      decoder.decode(chunk.subarray(0, header)),
      "http://ns.adobe.com/xmp/extension/\0",
    );
    assertEquals(decoder.decode(chunk.subarray(header, header + 32)), guid);
    assertEquals(view.getUint32(header + 32), total);
    assertEquals(view.getUint32(header + 36), seen);

    const data = chunk.subarray(header + 40);
    packet.set(data, seen);
    seen += data.length;
  }

  assertEquals(seen, total);
  assertEquals(md5Hex(packet).toUpperCase(), guid);

  const base64 = decoder.decode(packet).match(/GDepth:Data="([^"]*)"/)?.[1] ??
    "";
  assertEquals([...Uint8Array.fromBase64(base64)], [...depth]);
});

Deno.test("the segments go after the JFIF header and before the image data", () => {
  const jpeg = embedDepthMap(jpegShell(), Uint8Array.from([1, 2, 3]), {
    mime: "image/jpeg",
  });

  const original = jpegShell();
  assertEquals([...jpeg.subarray(0, 8)], [...original.subarray(0, 8)]);
  assertEquals([...jpeg.subarray(jpeg.length - 9)], [...original.subarray(8)]);
});

Deno.test("a file that is not a JPEG is refused", () => {
  assertThrows(
    () =>
      embedDepthMap(Uint8Array.from([0x89, 0x50]), new Uint8Array(4), {
        mime: "image/png",
      }),
    Error,
    "Not a JPEG",
  );
});

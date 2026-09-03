/**
 * Media validation and R2 key construction.
 *
 * The client-supplied Content-Type and filename are treated as hints, never
 * as facts. Type is decided by sniffing magic bytes, and the R2 key is
 * built entirely from server-generated IDs — an uploaded filename never
 * reaches the object key, so path traversal and key collisions are
 * structurally impossible rather than filtered.
 */

export type MediaKind = "image" | "audio";

export interface SniffedType {
  mime: string;
  kind: MediaKind;
  extension: string;
}

/** Byte-signature table. Only formats the frozen theme can actually use. */
const SIGNATURES: Array<{
  mime: string;
  kind: MediaKind;
  extension: string;
  test: (b: Uint8Array) => boolean;
}> = [
  {
    mime: "image/jpeg",
    kind: "image",
    extension: "jpg",
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: "image/png",
    kind: "image",
    extension: "png",
    test: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mime: "image/webp",
    kind: "image",
    extension: "webp",
    // "RIFF" .... "WEBP"
    test: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
  {
    mime: "image/avif",
    kind: "image",
    extension: "avif",
    // ftyp box with an "avif"/"avis" brand
    test: (b) =>
      b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 &&
      b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69 &&
      (b[11] === 0x66 || b[11] === 0x73),
  },
  {
    mime: "audio/mpeg",
    kind: "audio",
    extension: "mp3",
    // ID3-tagged, or a bare MPEG frame sync.
    test: (b) =>
      (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) ||
      (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0),
  },
  {
    mime: "audio/mp4",
    kind: "audio",
    extension: "m4a",
    // ftyp with an M4A brand
    test: (b) =>
      b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 &&
      b[8] === 0x4d && b[9] === 0x34 && b[10] === 0x41,
  },
  {
    mime: "audio/ogg",
    kind: "audio",
    extension: "ogg",
    test: (b) => b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53,
  },
  {
    mime: "audio/wav",
    kind: "audio",
    extension: "wav",
    // "RIFF" .... "WAVE"
    test: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45,
  },
];

/**
 * Identify a payload from its leading bytes.
 *
 * SVG is deliberately absent: it is an executable document, and serving
 * one from the media origin would be a stored-XSS vector. It is rejected
 * as an unknown type rather than special-cased, so no code path can be
 * talked into accepting it.
 */
export function sniffType(bytes: Uint8Array): SniffedType | null {
  if (bytes.length < 12) return null;
  for (const sig of SIGNATURES) {
    if (sig.test(bytes)) return { mime: sig.mime, kind: sig.kind, extension: sig.extension };
  }
  return null;
}

/**
 * Image dimensions, parsed from the container header.
 *
 * Worth doing by hand: the alternative is decoding the image, which on
 * workerd means either a WASM decoder in the upload path or a second
 * service. Dimensions are only needed for admin display and focal-point
 * maths, so a header read is the proportionate solution. Unknown
 * dimensions are stored as null rather than guessed.
 */
export function readDimensions(bytes: Uint8Array, mime: string): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  try {
    if (mime === "image/png") {
      // IHDR is always the first chunk: width/height at fixed offsets.
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }

    if (mime === "image/jpeg") {
      // Walk the marker segments to the first frame header.
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = bytes[offset + 1]!;
        // SOF0..SOF15, excluding the non-frame markers DHT/JPG/DAC.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
        }
        offset += 2 + view.getUint16(offset + 2);
      }
      return null;
    }

    if (mime === "image/webp") {
      const fourcc = String.fromCharCode(...bytes.slice(12, 16));
      if (fourcc === "VP8X") {
        // 24-bit little-endian, stored as (dimension - 1).
        const w = (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)) + 1;
        const h = (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) + 1;
        return { width: w, height: h };
      }
      if (fourcc === "VP8 ") {
        return {
          width: view.getUint16(26, true) & 0x3fff,
          height: view.getUint16(28, true) & 0x3fff,
        };
      }
      if (fourcc === "VP8L") {
        const bits = view.getUint32(21, true);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      return null;
    }
  } catch {
    // A truncated or malformed header is not an upload failure; the asset
    // simply has no recorded dimensions.
    return null;
  }

  return null;
}

/**
 * Object key.
 *
 * Every segment is a server-generated ID, and the asset ID makes the key
 * unique per upload. Replacing a photo therefore writes a new object
 * rather than overwriting `hero.jpg`, which is what lets a published
 * revision keep pointing at the exact bytes it was published with.
 *
 * The tenant/invitation prefixes give the orphan scanner a deterministic
 * structure to walk.
 */
export function storageKey(
  tenantId: string,
  invitationId: string,
  assetId: string,
  extension: string
): string {
  return `t/${tenantId}/i/${invitationId}/a/${assetId}/original.${extension}`;
}

/** Slots the frozen cinematic theme understands. WS6 moves this to the
 * theme manifest; until then it is the one hardcoded list. */
const CINEMATIC_SLOTS = new Set([
  "hero",
  "portrait",
  "story",
  "landscape",
  "venue",
  "closing",
  "background_music",
]);

export function validateSlot(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !CINEMATIC_SLOTS.has(raw)) return null;
  return raw;
}

export function isKnownSlot(raw: unknown): boolean {
  return typeof raw === "string" && CINEMATIC_SLOTS.has(raw);
}

/** Focal point, stored as simple portable percentages. */
export interface FocalPoint {
  x: number;
  y: number;
}

export function validateFocal(raw: unknown): FocalPoint | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { x, y } = raw as Record<string, unknown>;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || x > 100 || y < 0 || y > 100) return null;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

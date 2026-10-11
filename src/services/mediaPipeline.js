/**
 * Media processing pipeline (local, via sharp):
 *  - image → WhatsApp sticker webp (512×512, transparent padding)
 *  - sticker webp → png (for .toimg)
 *  - blur, meme captioning (SVG text overlay)
 *
 * Pure functions over Buffers so they are unit-testable without WhatsApp.
 */

import sharp from 'sharp';

const MAX_INPUT = 15 * 1024 * 1024; // 15 MB safety cap

function guard(input) {
  if (!Buffer.isBuffer(input) || input.length === 0) {
    throw new Error('No image data received.');
  }
  if (input.length > MAX_INPUT) {
    throw new Error('Image too large (15 MB max).');
  }
  return input;
}

/** Convert any supported image into a static WhatsApp sticker (webp). */
export async function toStickerWebp(input) {
  const buf = guard(input);
  return sharp(buf, { animated: false })
    .resize(512, 512, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 85, effort: 4 })
    .toBuffer();
}

/** Convert a sticker/webp image back to PNG. */
export async function webpToPng(input) {
  const buf = guard(input);
  return sharp(buf).png().toBuffer();
}

/** Blur an image (radius 0.3–100 mapped to sigma). */
export async function blurImage(input, radius = 5) {
  const buf = guard(input);
  const sigma = Math.min(Math.max(Number(radius) || 5, 0.3), 100);
  return sharp(buf).blur(sigma).jpeg({ quality: 85 }).toBuffer();
}

const escapeXml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * Meme caption: white impact-style text with black outline over the image.
 * @param {Buffer} input
 * @param {{ top?: string, bottom?: string }} texts
 */
export async function memeCaption(input, { top = '', bottom = '' } = {}) {
  const buf = guard(input);
  const img = sharp(buf);
  const meta = await img.metadata();
  const w = meta.width ?? 800;
  const h = meta.height ?? 600;
  const fontSize = Math.max(28, Math.round(w / 12));

  const makeText = (text, y) =>
    `<text x="50%" y="${y}" text-anchor="middle" font-family="sans-serif" font-weight="bold"
      font-size="${fontSize}" fill="white" stroke="black" stroke-width="${Math.round(fontSize / 12)}"
      paint-order="stroke" >${escapeXml(text)}</text>`;

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    ${top ? makeText(top.toUpperCase(), fontSize * 1.2) : ''}
    ${bottom ? makeText(bottom.toUpperCase(), h - fontSize * 0.35) : ''}
  </svg>`;

  return sharp(buf)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** Downscale and re-encode for profile pictures. */
export async function toProfilePicture(input) {
  const buf = guard(input);
  return sharp(buf)
    .resize(640, 640, { fit: 'cover', position: 'attention' })
    .jpeg({ quality: 88 })
    .toBuffer();
}

/** Validate that a buffer really is a decodable image; returns metadata. */
export async function imageInfo(input) {
  const buf = guard(input);
  return sharp(buf).metadata();
}

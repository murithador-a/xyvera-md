import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import {
  toStickerWebp,
  webpToPng,
  blurImage,
  memeCaption,
  toProfilePicture,
  imageInfo,
} from '../src/services/mediaPipeline.js';

/** A small real JPEG for pipeline tests. */
async function sampleJpeg(width = 200, height = 120) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 60, b: 60 } },
  })
    .jpeg()
    .toBuffer();
}

test('toStickerWebp produces a 512x512 webp', async () => {
  const out = await toStickerWebp(await sampleJpeg());
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 512);
});

test('toStickerWebp preserves aspect ratio inside the canvas', async () => {
  const out = await toStickerWebp(await sampleJpeg(100, 50));
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 512); // padded canvas
});

test('webpToPng round-trips a sticker back to png', async () => {
  const webp = await toStickerWebp(await sampleJpeg());
  const png = await webpToPng(webp);
  const meta = await sharp(png).metadata();
  assert.equal(meta.format, 'png');
  assert.equal(meta.width, 512);
});

test('blurImage returns a valid jpeg of the same size', async () => {
  const out = await blurImage(await sampleJpeg(120, 80), 8);
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 120);
  assert.equal(meta.height, 80);
});

test('memeCaption composites top and bottom text', async () => {
  const out = await memeCaption(await sampleJpeg(400, 300), { top: 'when the bot', bottom: 'works perfectly' });
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 400);
});

test('memeCaption escapes XML special characters safely', async () => {
  const out = await memeCaption(await sampleJpeg(100, 100), {
    top: '<script>&"quotes"',
    bottom: "it's fine",
  });
  assert.ok(out.length > 0);
});

test('toProfilePicture produces a 640x640 jpeg', async () => {
  const out = await toProfilePicture(await sampleJpeg(900, 300));
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 640);
  assert.equal(meta.height, 640);
});

test('invalid input is rejected with a clear error', async () => {
  await assert.rejects(() => toStickerWebp(Buffer.alloc(0)), /No image data/);
  await assert.rejects(() => toStickerWebp(Buffer.from('not an image')), /Input buffer/);
  await assert.rejects(() => blurImage(Buffer.alloc(20 * 1024 * 1024)), /too large/);
});

test('imageInfo validates real images', async () => {
  const info = await imageInfo(await sampleJpeg());
  assert.equal(info.format, 'jpeg');
});

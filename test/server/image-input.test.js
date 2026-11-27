import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeImage } from '../../server/image-input.js';
import sharp from 'sharp';

test('normalizes a known image into channel-first RGB pixels scaled to zero through one', async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 200, g: 100, b: 50 } } }).png().toBuffer();
  const image = await normalizeImage(png);
  assert.equal(image.width, 224);
  assert.equal(image.height, 224);
  assert.equal(image.values.length, 224 * 224 * 3);
  assert.ok(image.values.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
});

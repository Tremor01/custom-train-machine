import sharp from 'sharp';

const MAX_CLASSES = 20;
const MAX_EXAMPLES_PER_CLASS = 200;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 25_000_000;

export function dataUrlToBuffer(dataUrl) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error('Unsupported image data.');
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Image exceeds size limit.');
  return { mimeType: `image/${match[1]}`, buffer };
}

export function validateJpegDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > MAX_IMAGE_BYTES * 1.4 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) throw new Error('Invalid JPEG frame.');
  return dataUrlToBuffer(dataUrl).buffer;
}

export async function normalizeImage(buffer) {
  if (!(Buffer.isBuffer(buffer) || buffer instanceof Uint8Array) || buffer.byteLength === 0) throw new Error('Image exceeds size limit.');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Image exceeds size limit.');
  const source = sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' });
  const metadata = await source.metadata();
  if (!['jpeg', 'png', 'webp'].includes(metadata.format) || !metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
    throw new Error('Unsupported or oversized image.');
  }
  const { data, info } = await source.rotate().resize(224, 224, { fit: 'fill' }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const values = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) values[i] = data[i] / 255;
  return { values, width: info.width, height: info.height };
}

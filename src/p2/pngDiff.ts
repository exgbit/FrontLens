import { readFile, writeFile } from 'node:fs/promises';
import { inflateSync, deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface PixelDiffResult {
  ratio: number;
  changedPixels: number;
  totalPixels: number;
  currentSize: { width: number; height: number };
  baselineSize: { width: number; height: number };
  sizeMismatch: boolean;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

function assertPng(buffer: Buffer): void {
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('Not a PNG file.');
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function channelsFor(colorType: number): number {
  if (colorType === 0) return 1;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  throw new Error(`Unsupported PNG color type ${colorType}.`);
}

function toRgba(raw: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * channels;
    const target = pixel * 4;
    if (channels === 1) {
      const value = raw[source];
      rgba[target] = value;
      rgba[target + 1] = value;
      rgba[target + 2] = value;
      rgba[target + 3] = 255;
    } else if (channels === 2) {
      const value = raw[source];
      rgba[target] = value;
      rgba[target + 1] = value;
      rgba[target + 2] = value;
      rgba[target + 3] = raw[source + 1];
    } else if (channels === 3) {
      rgba[target] = raw[source];
      rgba[target + 1] = raw[source + 1];
      rgba[target + 2] = raw[source + 2];
      rgba[target + 3] = 255;
    } else {
      rgba[target] = raw[source];
      rgba[target + 1] = raw[source + 1];
      rgba[target + 2] = raw[source + 2];
      rgba[target + 3] = raw[source + 3];
    }
  }
  return rgba;
}

export function decodePng(buffer: Buffer): PngImage {
  assertPng(buffer);
  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatChunks: Buffer[] = [];

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idatChunks.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
  }

  if (!width || !height) throw new Error('PNG IHDR is missing or invalid.');
  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}; only 8-bit screenshots are supported.`);
  if (interlace !== 0) throw new Error('Interlaced PNG screenshots are not supported.');
  const channels = channelsFor(colorType);
  const bpp = channels;
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const raw = new Uint8Array(width * height * channels);
  let inOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inOffset++];
    const rowStart = y * stride;
    const prevRowStart = (y - 1) * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? raw[rowStart + x - bpp] : 0;
      const up = y > 0 ? raw[prevRowStart + x] : 0;
      const upLeft = y > 0 && x >= bpp ? raw[prevRowStart + x - bpp] : 0;
      const value = inflated[inOffset++];
      if (filter === 0) raw[rowStart + x] = value;
      else if (filter === 1) raw[rowStart + x] = (value + left) & 0xff;
      else if (filter === 2) raw[rowStart + x] = (value + up) & 0xff;
      else if (filter === 3) raw[rowStart + x] = (value + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) raw[rowStart + x] = (value + paeth(left, up, upLeft)) & 0xff;
      else throw new Error(`Unsupported PNG filter ${filter}.`);
    }
  }
  return { width, height, rgba: toRgba(raw, width, height, channels) };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuffer.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return out;
}

export function encodePng(image: PngImage): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = image.width * 4;
  const scanlines = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    const rowStart = y * (stride + 1);
    scanlines[rowStart] = 0;
    Buffer.from(image.rgba.buffer, image.rgba.byteOffset + y * stride, stride).copy(scanlines, rowStart + 1);
  }
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
}

function pixelAt(image: PngImage, x: number, y: number): [number, number, number, number] | undefined {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return undefined;
  const offset = (y * image.width + x) * 4;
  return [image.rgba[offset], image.rgba[offset + 1], image.rgba[offset + 2], image.rgba[offset + 3]];
}

function colorDistance(a: [number, number, number, number], b: [number, number, number, number]): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]), Math.abs(a[3] - b[3]));
}

export async function diffPngFiles(currentPath: string, baselinePath: string, diffPath: string, pixelThreshold = 16): Promise<PixelDiffResult> {
  const [current, baseline] = await Promise.all([readFile(currentPath).then(decodePng), readFile(baselinePath).then(decodePng)]);
  const width = Math.max(current.width, baseline.width);
  const height = Math.max(current.height, baseline.height);
  const totalPixels = width * height;
  const diffRgba = new Uint8Array(totalPixels * 4);
  let changedPixels = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4;
      const a = pixelAt(current, x, y);
      const b = pixelAt(baseline, x, y);
      const changed = !a || !b || colorDistance(a, b) > pixelThreshold;
      if (changed) {
        changedPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        diffRgba[target] = a && !b ? 255 : 230;
        diffRgba[target + 1] = a && !b ? 0 : 30;
        diffRgba[target + 2] = a && !b ? 255 : 30;
        diffRgba[target + 3] = 255;
      } else {
        diffRgba[target] = Math.round((a![0] + b![0]) / 4);
        diffRgba[target + 1] = Math.round((a![1] + b![1]) / 4);
        diffRgba[target + 2] = Math.round((a![2] + b![2]) / 4);
        diffRgba[target + 3] = 120;
      }
    }
  }

  await writeFile(diffPath, encodePng({ width, height, rgba: diffRgba }));
  return {
    ratio: totalPixels === 0 ? 0 : changedPixels / totalPixels,
    changedPixels,
    totalPixels,
    currentSize: { width: current.width, height: current.height },
    baselineSize: { width: baseline.width, height: baseline.height },
    sizeMismatch: current.width !== baseline.width || current.height !== baseline.height,
    boundingBox: changedPixels > 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : undefined
  };
}

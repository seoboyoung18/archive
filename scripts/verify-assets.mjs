import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

const root = new URL('../assets/characters/h1/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('derived/v1/manifest.json', root), 'utf8').replace(/^\uFEFF/, ''));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(readFileSync(new URL('reference.png', root))), manifest.referenceSha256, 'Reference changed');
assert.deepEqual(manifest.root, [256, 448]);
assert.deepEqual(manifest.canvas, [512, 512]);
assert.equal(manifest.displayScale, 0.625);
assert.deepEqual(manifest.frames.map(frame => frame.id), ['idle', 'startup', 'active', 'recovery']);

function decode(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.equal(bytes[24], 8, 'Expected 8-bit PNG');
  assert.equal(bytes[25], 6, 'Expected RGBA');
  assert.equal(bytes[28], 0, 'Interlaced PNG unsupported');
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const packed = inflateSync(Buffer.concat(chunks));
  const stride = width * 4, pixels = Buffer.alloc(stride * height);
  assert.equal(packed.length, (stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = packed[y * (stride + 1)];
    assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const a = x >= 4 ? pixels[index - 4] : 0;
      const b = y ? pixels[index - stride] : 0;
      const c = y && x >= 4 ? pixels[index - stride - 4] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      pixels[index] = (packed[y * (stride + 1) + 1 + x] + predictor) & 255;
    }
  }
  return { width, height, pixels };
}

for (const frame of manifest.frames) {
  assert.equal(frame.scale, manifest.frames[0].scale, 'Sequence must share scale');
  assert.equal(hash(readFileSync(new URL(frame.source, root))), frame.sourceSha256);
  const bytes = readFileSync(new URL(frame.output, root));
  assert.equal(hash(bytes), frame.outputSha256);
  const { width, height, pixels } = decode(bytes);
  assert.deepEqual([width, height], [512, 512]);
  const bounds = { left: width, top: height, right: -1, bottom: -1 };
  let transparent = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = pixels[(y * width + x) * 4 + 3];
    if (alpha === 0) transparent++;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) assert.equal(alpha, 0, 'Sprite clipped');
    if (alpha >= manifest.alphaThreshold) {
      bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x);
      bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y);
    }
  }
  assert.ok(transparent > width * height / 2, 'Expected transparent background');
  assert.deepEqual(bounds, frame.outputBounds);
  assert.ok(Math.abs(bounds.bottom + 1 - 448) <= 1, 'Soles must meet baseline');
  assert.ok(Math.abs(bounds.top - 64) <= 1, 'Shared body height drift');
  assert.ok(Math.abs(frame.sourceRoot[0] * frame.scale + frame.offset[0] - 256) < 0.0001);
  assert.ok(Math.abs(frame.sourceRoot[1] * frame.scale + frame.offset[1] - 448) < 0.0001);
  console.log(`${frame.id}: 512x512 RGBA, transparent margins, root aligned, hashes intact`);
}
console.log('PASS: 4 draft assets. Visual consistency requires separate review.');

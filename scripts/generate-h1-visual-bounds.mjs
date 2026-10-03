import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { H1_POSES, H1_THROW_POSES } from '../src/characters/h1-poses.ts';

const poses = ['idle-0', 'idle-1', 'crouch', 'stand-guard', 'crouch-guard',
  'stand-hit', 'crouch-hit', 'ko-0', 'ko-1', 'ko-2',
  'grab-ready', 'grab-reach', 'grab-retract', 'grab-settle', 'grab-release',
  'grab-stand-hold', 'grab-crouch-hold', 'grabbed-stand-hold', 'grabbed-crouch-hold',
  'grabbed-stand-recover', 'grabbed-crouch-recover', 'grabbed-stand-escape', 'grabbed-crouch-escape',
  ...H1_THROW_POSES];
const rotated = new Set(['grabbed-stand-hold', 'grabbed-crouch-hold', 'thrown-air']);
const root = new URL('../assets/characters/h1/derived/', import.meta.url);
const target = new URL('../src/characters/h1-visual-bounds.ts', import.meta.url);

function hull(points) {
  const sorted = [...new Map(points.map(p => [p.join(','), p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of sorted) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
  for (const p of [...sorted].reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
function geometry(pose) {
  const file = H1_POSES[pose], [version, name] = file.split('/');
  const manifest = JSON.parse(readFileSync(new URL(`${version}/manifest.json`, root), 'utf8').replace(/^\uFEFF/, ''));
  const frame = manifest.frames.find(f => f.id === name.replace('.png', ''));
  const bytes = readFileSync(new URL(file, root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), frame.outputSha256);
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20), bytes[24], bytes[25], bytes[28]], [512, 512, 8, 6, 0]);
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const n = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + n));
    offset += n + 12;
  }
  const packed = inflateSync(Buffer.concat(chunks)), stride = 512 * 4, pixels = Buffer.alloc(stride * 512);
  assert.equal(packed.length, (stride + 1) * 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < stride; x++) {
    const i = y * stride + x, a = x >= 4 ? pixels[i - 4] : 0, b = y ? pixels[i - stride] : 0;
    const c = y && x >= 4 ? pixels[i - stride - 4] : 0, p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c), filter = packed[y * (stride + 1)];
    assert.ok(filter <= 4);
    const prediction = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    pixels[i] = (packed[y * (stride + 1) + 1 + x] + prediction) & 255;
  }
  let left = 512, right = 0; const corners = [];
  const alignment = { left: 512, right: -1, top: 512, bottom: -1 };
  for (let y = 0; y < 512; y++) {
    let rowLeft = 512, rowRight = -1;
    for (let x = 0; x < 512; x++) {
      const alpha = pixels[(y * 512 + x) * 4 + 3];
      if (alpha > 0) { rowLeft = Math.min(rowLeft, x); rowRight = Math.max(rowRight, x); }
      if (alpha >= manifest.alphaThreshold) {
        alignment.left = Math.min(alignment.left, x); alignment.right = Math.max(alignment.right, x);
        alignment.top = Math.min(alignment.top, y); alignment.bottom = Math.max(alignment.bottom, y);
      }
    }
    if (rowRight >= 0) {
      left = Math.min(left, rowLeft); right = Math.max(right, rowRight + 1);
      corners.push([rowLeft, y], [rowRight + 1, y], [rowLeft, y + 1], [rowRight + 1, y + 1]);
    }
  }
  assert.deepEqual(alignment, frame.outputBounds);
  return { x: [left, right], hull: rotated.has(pose) ? hull(corners) : null };
}
const data = Object.fromEntries(poses.map(pose => [pose, geometry(pose)]));
const idle = [Math.min(data['idle-0'].x[0], data['idle-1'].x[0]), Math.max(data['idle-0'].x[1], data['idle-1'].x[1])];
data['idle-0'].x = idle; data['idle-1'].x = idle;
const format = values => JSON.stringify(values).replaceAll(',', ', ');
const output = '// Generated from alpha > 0 PNG pixel cells; right edges are exclusive.\n'
  + '// Reproduce with: node --experimental-strip-types scripts/generate-h1-visual-bounds.mjs\n'
  + '// Idle frames share their union to keep the displayed root steady.\n'
  + 'export const H1_VISUAL_BOUNDS: Readonly<Record<string, readonly [number, number]>> = {\n'
  + poses.map(pose => `  '${pose}': ${format(data[pose].x)},`).join('\n') + '\n};\n\n'
  + '// Convex hulls preserve the exact horizontal projection after rotation and reflection.\n'
  + 'export const H1_VISUAL_HULLS: Readonly<Record<string, readonly (readonly [number, number])[]>> = {\n'
  + [...rotated].map(pose => `  '${pose}': [\n${data[pose].hull.map(point => `    ${format(point)},`).join('\n')}\n  ],`).join('\n') + '\n};\n';
if (process.argv.includes('--check')) assert.equal(readFileSync(target, 'utf8').replace(/\r\n/g, '\n'), output);
else writeFileSync(target, output);
console.log(JSON.stringify({ poses: poses.length, idleUnion: idle, hullVertices: Object.fromEntries([...rotated].map(pose => [pose, data[pose].hull.length])) }));

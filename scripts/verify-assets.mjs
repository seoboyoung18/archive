import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

const root = new URL('../assets/characters/h1/', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const decoded = new Map();
for (const version of ['v1', 'v2', 'movement-v1', 'combat-v1', 'motion-v1', 'walk-v2']) {
const manifest = JSON.parse(readFileSync(new URL(`derived/${version}/manifest.json`, root), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(hash(readFileSync(new URL('reference.png', root))), manifest.referenceSha256, 'Reference changed');
assert.deepEqual(manifest.root, [256, 448]);
assert.deepEqual(manifest.canvas, [512, 512]);
assert.equal(manifest.displayScale, 0.625);
let ids = ['idle', 'startup', 'active', 'recovery'];
if (version === 'v2') ids.push('crouch', 'crouch-startup', 'crouch-active', 'crouch-recovery');
if (version === 'movement-v1') ids = ['idle-1','walk-0','walk-1','walk-2','walk-3','jump-rise','jump-apex','jump-fall'];
if (version === 'motion-v1') ids = ['lp-extend','lp-retract','lp-settle','walk-mid-0','walk-mid-1','walk-mid-2','walk-mid-3'];
if (version === 'walk-v2') ids = Array.from({length:12},(_,i)=>`walk-${String(i).padStart(2,'0')}`);
if (version === 'combat-v1') ids = ['stand-hp','stand-lk','stand-hk','crouch-lp','crouch-hp','crouch-hk'].flatMap(a => ['startup','active','recovery'].map(p => `${a}-${p}`)).concat(['stand-guard','crouch-guard','stand-hit','crouch-hit','ko-0','ko-1','ko-2']);
assert.deepEqual(manifest.frames.map(frame => frame.id), ids);

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
  decoded.set(`${version}/${frame.id}`, pixels);
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
  if (frame.id.startsWith('jump-')) {
    assert.equal(frame.rootMode, 'idle-virtual-ground');
    assert.equal(frame.sourceRoot[1], 1194, 'Jump root must not follow curled feet');
  } else assert.ok(Math.abs(bounds.bottom + 1 - 448) <= 1, 'Soles must meet baseline');
  if (version === 'combat-v1') {
    // Attacks and knockdowns change posture; do not stretch every silhouette to idle height.
    assert.deepEqual(frame.sourceSize, [1254,1254], 'Review common scale for new source dimensions');
    assert.equal(frame.scale, 384/1120, 'Preserve the calibrated anatomical scale');
    const b = frame.sourceBounds;
    assert.ok(b.left > 0 && b.top > 0 && b.right < 1253 && b.bottom < 1253, 'Source sprite clipped');
    if (frame.id.startsWith('crouch')) assert.ok(bounds.top > 160 && bounds.top < 448, 'Crouch should stay low');
    if (frame.id.startsWith('ko-')) assert.equal(frame.rootMode, 'body-bottom');
  }
  else if (!frame.id.startsWith('crouch')) assert.ok(Math.abs(bounds.top - 64) <= (['movement-v1','motion-v1','walk-v2'].includes(version) ? 5 : 1), `${version}/${frame.id}: body height drift (top=${bounds.top})`);
  else assert.ok(bounds.top > 160 && bounds.top < 448, 'Crouch should be lower, never scaled to standing height');
  assert.ok(Math.abs(frame.sourceRoot[0] * frame.scale + frame.offset[0] - 256) < 0.0001);
  assert.ok(Math.abs(frame.sourceRoot[1] * frame.scale + frame.offset[1] - 448) < 0.0001);
  console.log(`${version}/${frame.id}: 512x512 RGBA, transparent margins, root aligned, hashes intact`);
}
}
// Silhouette overlap measures foot stability, not artistic approval.
function overlap(a, b, x0, x1, y0, y1) {
  let intersection = 0, union = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * 512 + x) * 4 + 3, av = a[i] >= 8, bv = b[i] >= 8;
    if (av || bv) union++;
    if (av && bv) intersection++;
  }
  assert.ok(union > 0);
  return (100 * intersection / union).toFixed(2) + '%';
}
for (const version of ['v1', 'v2']) for (const id of ['startup', 'active', 'recovery']) {
  console.log(`${version}/${id} foot mask overlap with idle (y400..447): ${overlap(decoded.get(`${version}/idle`), decoded.get(`${version}/${id}`), 0, 512, 400, 448)}`);
}
for (const id of ['crouch-startup', 'crouch-active', 'crouch-recovery']) {
  console.log(`${id} support foot overlap (x100..229, y410..447): ${overlap(decoded.get('v2/crouch'), decoded.get(`v2/${id}`), 100, 230, 410, 448)}`);
}
for (const id of ['lp-extend','lp-retract','lp-settle']) console.log(`${id} foot mask overlap with idle (y400..447): ${overlap(decoded.get('v2/idle'), decoded.get(`motion-v1/${id}`), 0, 512, 400, 448)}`);
console.log('PASS: all source/output hashes, 512x512 RGBA, roots and margins. 52 runtime poses; previous versions preserved. Visual consistency requires separate review.');

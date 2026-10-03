import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

const root = new URL('../assets/characters/h1/', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const decoded = new Map();
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

for (const version of ['v1', 'v2', 'movement-v1', 'combat-v1', 'motion-v1', 'walk-v2', 'attack-motion-v1', 'opposite-limbs-v1', 'grab-v1', 'throw-v1']) {
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
if (version === 'attack-motion-v1') ids = ['stand-hp','stand-lk','stand-hk','crouch-lp','crouch-hp','crouch-lk','crouch-hk'].flatMap(a => (a === 'stand-hk' ? ['lift','apex','descend','retract','settle'] : ['extend','retract','settle']).map(p => `${a}-${p}`));
if (version === 'attack-motion-v1') ids.push('stand-lk-startup','stand-lk-recovery','stand-hk-recovery');
if (version === 'combat-v1') ids = ['stand-hp','stand-lk','stand-hk','crouch-lp','crouch-hp','crouch-hk'].flatMap(a => ['startup','active','recovery'].map(p => `${a}-${p}`)).concat(['stand-guard','crouch-guard','stand-hit','crouch-hit','ko-0','ko-1','ko-2']);
if (version === 'opposite-limbs-v1') ids = ['stand-hp','stand-hk','crouch-hp','crouch-hk'].flatMap(a => (a === 'stand-hk' ? ['startup','lift','apex','descend','active','retract','recovery','settle'] : ['startup','extend','active','retract','recovery','settle']).map(p => `${a}-${p}`));
if (version === 'grab-v1') ids = ["grab-ready","grab-reach","grab-retract","grab-settle","grab-stand-hold","grab-stand-brace","grab-stand-push","grab-crouch-hold","grab-crouch-brace","grab-crouch-push","grabbed-stand-hold","grabbed-stand-impact","grabbed-stand-recover","grabbed-crouch-hold","grabbed-crouch-impact","grabbed-crouch-recover","grab-release","grabbed-stand-escape","grabbed-crouch-escape"];
if (version === 'throw-v1') ids = ['throw-turn','throw-lift','throw-slam','thrown-air','thrown-down','thrown-rise'];
assert.deepEqual(manifest.frames.map(frame => frame.id), ids);

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
  if (frame.id.startsWith('jump-') || frame.id === 'thrown-air') {
    assert.equal(frame.rootMode, 'idle-virtual-ground');
    assert.equal(frame.sourceRoot[1], 1194, 'Jump root must not follow curled feet');
  } else assert.ok(Math.abs(bounds.bottom + 1 - 448) <= 1, 'Soles must meet baseline');
  if (version === 'combat-v1' || version === 'attack-motion-v1' || version === 'opposite-limbs-v1' || version === 'grab-v1' || version === 'throw-v1') {
    // Attacks and knockdowns change posture; do not stretch every silhouette to idle height.
    assert.deepEqual(frame.sourceSize, [1254,1254], 'Review common scale for new source dimensions');
    assert.equal(frame.scale, 384/1120, 'Preserve the calibrated anatomical scale');
    const b = frame.sourceBounds;
    assert.ok(b.left > 0 && b.top > 0 && b.right < 1253 && b.bottom < 1253, 'Source sprite clipped');
    if (frame.id.startsWith('crouch')) assert.ok(bounds.top > 160 && bounds.top < 448, 'Crouch should stay low');
    if (frame.id.startsWith('grabbed-crouch')) assert.ok(bounds.top > 160 && bounds.top < 448, 'Grabbed crouch should stay low');
    if (frame.id.startsWith('ko-') || frame.id === 'thrown-down') assert.equal(frame.rootMode, 'body-bottom');
  }
  else if (!frame.id.startsWith('crouch')) assert.ok(Math.abs(bounds.top - 64) <= (['movement-v1','motion-v1','walk-v2'].includes(version) ? 5 : 1), `${version}/${frame.id}: body height drift (top=${bounds.top})`);
  else assert.ok(bounds.top > 160 && bounds.top < 448, 'Crouch should be lower, never scaled to standing height');
  assert.ok(Math.abs(frame.sourceRoot[0] * frame.scale + frame.offset[0] - 256) < 0.0001);
  assert.ok(Math.abs(frame.sourceRoot[1] * frame.scale + frame.offset[1] - 448) < 0.0001);
  console.log(`${version}/${frame.id}: 512x512 RGBA, transparent margins, root aligned, hashes intact`);
}
}
// These sources use the already-normalized 512 canvas proportions, not the older full-body scale.
function alphaBounds(image, threshold = 8, checkEdge = true) {
  const { width, height, pixels } = image;
  const bounds = { left: width, top: height, right: -1, bottom: -1 };
  let transparent = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = pixels[(y * width + x) * 4 + 3];
    if (!alpha) transparent++;
    if (checkEdge && (!x || !y || x === width - 1 || y === height - 1)) assert.equal(alpha, 0, 'Sprite clipped');
    if (alpha >= threshold) {
      bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x);
      bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y);
    }
  }
  assert.ok(bounds.right >= bounds.left && bounds.bottom >= bounds.top, 'Empty sprite');
  assert.ok(transparent > width * height / 2, 'Expected transparent background');
  return bounds;
}
for (const version of ['flip-v1', 'supplement-v1', 'reaction-smooth-v1']) {
  const manifest = JSON.parse(readFileSync(new URL(`derived/${version}/manifest.json`, root), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(hash(readFileSync(new URL('reference.png', root))), manifest.referenceSha256, 'Reference changed');
  assert.deepEqual(manifest.canvas, [512, 512]); assert.deepEqual(manifest.root, [256, 448]);
  assert.equal(manifest.displayScale, .625); assert.equal(manifest.alphaThreshold, 8);
  assert.ok(manifest.frames.length > 0, `${version}: no frames`);
  assert.equal(new Set(manifest.frames.map(f => f.id)).size, manifest.frames.length, 'Duplicate frame id');
  for (const frame of manifest.frames) {
    assert.match(frame.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/); assert.ok(!frame.id.includes('rejected'));
    assert.equal(frame.source, `generated/${version}/${frame.id}.png`);
    assert.equal(frame.output, `derived/${version}/${frame.id}.png`);
    const sourceBytes = readFileSync(new URL(frame.source, root)), outputBytes = readFileSync(new URL(frame.output, root));
    assert.equal(hash(sourceBytes), frame.sourceSha256); assert.equal(hash(outputBytes), frame.outputSha256);
    const source = decode(sourceBytes), output = decode(outputBytes);
    assert.deepEqual([source.width, source.height], [1254, 1254]); assert.deepEqual(frame.sourceSize, [1254, 1254]);
    assert.deepEqual([output.width, output.height], [512, 512]);
    assert.deepEqual(alphaBounds(source, 8, false), frame.sourceBounds); assert.deepEqual(alphaBounds(output), frame.outputBounds);
    const b = frame.sourceBounds;
    assert.ok(b.left > 0 && b.top > 0 && b.right < 1253 && b.bottom < 1253, `${version}/${frame.id}: source silhouette clipped`);
    assert.equal(frame.scale, 512 / 1254, 'Preserve the source canvas ratio for every pose');
    assert.equal(frame.sourceRoot[0], 627); assert.ok(Math.abs(frame.offset[0]) < 1e-8);
    if (version === 'flip-v1') {
      assert.equal(frame.rootMode, 'canvas-virtual-ground'); assert.equal(frame.sourceRoot[1], 1254 * .875);
      assert.equal(frame.offset[1], 0, 'Curled feet must not move the virtual ground');
    } else {
      assert.equal(frame.sourceRoot[1], frame.sourceBounds.bottom + 1);
      assert.equal(frame.rootMode, /^(ko-|thrown-down)/.test(frame.id) ? 'body-bottom' : 'sole-bottom');
      assert.ok(Math.abs(frame.outputBounds.bottom + 1 - 448) <= 1, 'Soles/body must meet baseline');
    }
    assert.ok(Math.abs(frame.sourceRoot[0] * frame.scale + frame.offset[0] - 256) < 1e-8);
    assert.ok(Math.abs(frame.sourceRoot[1] * frame.scale + frame.offset[1] - 448) < 1e-8);
    console.log(`${version}/${frame.id}: fixed canvas ratio, RGBA, transparent margins, roots and hashes intact`);
  }
}
// The walking/idle in-betweens reference the old 1254 full-body artwork,
// so retain its single calibrated anatomical scale rather than fitting each pose.
{
  const version = 'smooth-v1';
  const manifest = JSON.parse(readFileSync(new URL(`derived/${version}/manifest.json`, root), 'utf8').replace(/^\uFEFF/, ''));
  const prompts = JSON.parse(readFileSync(new URL(`generated/${version}/prompts.json`, root), 'utf8'));
  const ids = [...Array.from({ length: 12 }, (_, i) => `walk-mid-${String(i).padStart(2, '0')}`), 'idle-in', 'idle-out'];
  assert.deepEqual(manifest.frames.map(f => f.id), ids);
  assert.deepEqual(prompts.frames.map(f => f.id), ids);
  assert.equal(hash(readFileSync(new URL('reference.png', root))), manifest.referenceSha256, 'Reference changed');
  assert.deepEqual(manifest.canvas, [512, 512]); assert.deepEqual(manifest.root, [256, 448]);
  assert.equal(manifest.displayScale, .625); assert.equal(manifest.alphaThreshold, 8);
  const sourcePixels = new Set(), outputPixels = new Set();
  const previousOutputPixels = new Set([...decoded.values()].map(hash));
  for (const frame of manifest.frames) {
    const prompt = prompts.frames.find(f => f.id === frame.id);
    assert.equal(frame.source, prompt.source, 'Only the selected original may enter the runtime');
    assert.equal(frame.output, `derived/${version}/${frame.id}.png`);
    assert.ok(!prompts.rejectedCandidates.some(f => f.source === frame.source), 'Rejected candidate selected');
    const sourceBytes = readFileSync(new URL(frame.source, root)), outputBytes = readFileSync(new URL(frame.output, root));
    assert.equal(hash(sourceBytes), frame.sourceSha256); assert.equal(hash(sourceBytes), prompt.sourceSha256);
    assert.equal(hash(outputBytes), frame.outputSha256);
    const source = decode(sourceBytes), output = decode(outputBytes);
    assert.deepEqual([source.width, source.height], [1254, 1254]); assert.deepEqual(frame.sourceSize, [1254, 1254]);
    assert.deepEqual([output.width, output.height], [512, 512]);
    assert.deepEqual(alphaBounds(source, 8), frame.sourceBounds);
    assert.deepEqual(alphaBounds(source, 1), frame.sourceBoundsAlpha0);
    assert.deepEqual(alphaBounds(output, 8), frame.outputBounds);
    assert.deepEqual(alphaBounds(output, 1), frame.outputBoundsAlpha0);
    assert.equal(frame.scale, 384 / 1120, 'Preserve the calibrated anatomical scale');
    assert.equal(frame.sourceCanvasScale, 1); assert.equal(frame.sourceRoot[0], 627);
    assert.equal(frame.sourceRoot[1], frame.sourceBounds.bottom + 1); assert.equal(frame.rootMode, 'sole-bottom');
    assert.ok(Math.abs(frame.outputBounds.bottom + 1 - 448) <= 1, 'Soles must meet baseline');
    assert.ok(Math.abs(frame.outputBounds.top - 64) <= 5, `${version}/${frame.id}: body height drift`);
    assert.ok(Math.abs(frame.sourceRoot[0] * frame.scale + frame.offset[0] - 256) < 1e-8);
    assert.ok(Math.abs(frame.sourceRoot[1] * frame.scale + frame.offset[1] - 448) < 1e-8);
    assert.ok(!previousOutputPixels.has(hash(output.pixels)), 'An in-between must not duplicate a previous output');
    sourcePixels.add(hash(source.pixels)); outputPixels.add(hash(output.pixels));
    decoded.set(`${version}/${frame.id}`, output.pixels);
    console.log(`${version}/${frame.id}: fixed anatomical scale, RGBA, actual alpha margins, roots and hashes intact`);
  }
  assert.equal(sourcePixels.size, ids.length, 'Generated in-betweens must be distinct drawings');
  assert.equal(outputPixels.size, ids.length, 'Normalized in-betweens must remain distinct');
  for (const candidate of prompts.rejectedCandidates) assert.equal(hash(readFileSync(new URL(candidate.source, root))), candidate.sourceSha256, 'Previous generated candidate must be preserved');
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
for (const [attack, phase] of [['stand-lk','startup'],['stand-lk','recovery'],['stand-hk','recovery']]) {
  const active = decoded.get(`combat-v1/${attack}-active`);
  for (const version of ['combat-v1','attack-motion-v1']) console.log(`${version}/${attack}-${phase} support foot overlap with impact (x100..199,y400..447): ${overlap(active, decoded.get(`${version}/${attack}-${phase}`), 100, 200, 400, 448)}`);
}
console.log('PASS: all source/output hashes, 512x512 RGBA, roots and margins. Current registry is checked by combat-poses tests; previous versions preserved. Visual consistency requires separate review.');

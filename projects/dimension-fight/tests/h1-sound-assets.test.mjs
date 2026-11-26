import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSoundAssets, encodeWave, OUTPUT_DIR } from '../scripts/generate-h1-sounds.mjs';
import { measureAuditionMixes, readSoundWave, validatePcm, verifySoundAssets } from '../scripts/verify-sounds.mjs';

test('S1: nine saved audition WAVs and comparison reel have valid PCM and exact seeded reproduction', () => {
  const result = verifySoundAssets();
  assert.equal(result.sounds.length, 10);
  assert.equal(result.mixes.length, 5);
});

test('S1: identical simultaneous punches add without limiting and all five prescribed 100% mixes remain below unity', () => {
  const { files, manifest } = buildSoundAssets();
  const pcmById = new Map(manifest.sounds.map(sound => [sound.id, readSoundWave(files.get(sound.file))]));
  const mixes = measureAuditionMixes(pcmById);
  const hp = pcmById.get('hit-hp');
  let actualHpPeak = 0;
  for (let i = 0; i < hp.length; i += 2) actualHpPeak = Math.max(actualHpPeak, Math.abs(hp.readInt16LE(i) / 32768));
  assert.equal(mixes.find(mix => mix.id === 'double-hit').peak, actualHpPeak * 2);
  for (const mix of mixes) assert.ok(mix.peak < 1 && mix.belowUnity, mix.id);
  const tooLoud = Buffer.from(hp);
  tooLoud.writeInt16LE(20000, 500);
  pcmById.set('hit-hp', tooLoud);
  const overloaded = measureAuditionMixes(pcmById).find(mix => mix.id === 'double-hit');
  assert.equal(overloaded.peak, 40000 / 32768);
  assert.equal(overloaded.belowUnity, false, 'a clipped mix cannot be disguised by per-file checks or a hidden gain');
});

test('S1: a second in-memory synthesis yields identical bytes without touching the assets', () => {
  const first = buildSoundAssets(), second = buildSoundAssets();
  assert.equal(first.files.size, 11);
  for (const [file, bytes] of first.files) assert.ok(bytes.equals(second.files.get(file)), file);
});

test('S1: reel segments preserve individual PCM and the stated silence rather than renormalizing their levels', () => {
  const manifest = JSON.parse(readFileSync(resolve(OUTPUT_DIR, 'manifest.json'), 'utf8'));
  const reel = readSoundWave(readFileSync(resolve(OUTPUT_DIR, manifest.reel.file)));
  let previousEnd = 0;
  for (const segment of manifest.reel.sequence) {
    const start = Math.round(segment.startMs * 48) * 2;
    assert.ok(reel.subarray(previousEnd, start).every(byte => byte === 0), `${segment.id}: silence before`);
    const individual = readSoundWave(readFileSync(resolve(OUTPUT_DIR, `${segment.id}.wav`)));
    assert.ok(reel.subarray(start, start + individual.length).equals(individual), segment.id);
    previousEnd = start + individual.length;
  }
  assert.ok(reel.subarray(previousEnd).every(byte => byte === 0), 'silence after final sound');
});

test('S1: validation rejects malformed format/data lengths and silent, clipped or abrupt endpoint audio', () => {
  const original = readFileSync(resolve(OUTPUT_DIR, 'hit-lp.wav'));
  for (const [offset, value] of [[22, 2], [24, 44100], [32, 4], [34, 8], [40, 8]]) {
    const altered = Buffer.from(original);
    if ([24, 40].includes(offset)) altered.writeUInt32LE(value, offset);
    else altered.writeUInt16LE(value, offset);
    assert.throws(() => readSoundWave(altered));
  }
  assert.throws(() => readSoundWave(original.subarray(0, original.length - 1)));
  assert.throws(() => validatePcm(Buffer.alloc(960)), /silent/);
  for (const value of [-32768, 32767]) {
    const altered = Buffer.from(readSoundWave(original)); altered.writeInt16LE(value, 500);
    assert.throws(() => validatePcm(altered), /clipped/);
  }
  for (const offset of [0, original.length - 46]) {
    const altered = Buffer.from(readSoundWave(original)); altered.writeInt16LE(8192, offset);
    assert.throws(() => validatePcm(altered), /sample must be zero/);
  }
  const stepped = Buffer.from(readSoundWave(original)); stepped.writeInt16LE(8192, 2);
  assert.throws(() => validatePcm(stepped), /abrupt step/);
});

test('S1: PCM encoding refuses non-finite and out-of-range input instead of silently clamping it', () => {
  for (const invalid of [NaN, Infinity, -Infinity, 1, -1, 1.2]) {
    assert.throws(() => encodeWave(new Float64Array([0, invalid, 0])), /Invalid or clipped/);
  }
});

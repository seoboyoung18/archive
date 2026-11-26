import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AUDITION_SEQUENCES, buildSoundAssets, measurePcm, OUTPUT_DIR, SAMPLE_RATE, sha256 } from './generate-h1-sounds.mjs';

/** Read the canonical PCM16 mono WAV used by this asset set; reject malformed headers. */
export function readSoundWave(wav) {
  assert.ok(wav.length >= 46, 'WAV must contain a header and at least one sample');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF', 'RIFF header');
  assert.equal(wav.readUInt32LE(4), wav.length - 8, 'RIFF byte length');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE', 'WAVE header');
  assert.equal(wav.toString('ascii', 12, 16), 'fmt ', 'format chunk');
  assert.equal(wav.readUInt32LE(16), 16, 'PCM format chunk size');
  assert.equal(wav.readUInt16LE(20), 1, 'uncompressed PCM');
  assert.equal(wav.readUInt16LE(22), 1, 'mono');
  assert.equal(wav.readUInt32LE(24), 48000, '48 kHz');
  assert.equal(wav.readUInt32LE(28), 96000, 'PCM byte rate');
  assert.equal(wav.readUInt16LE(32), 2, 'block alignment');
  assert.equal(wav.readUInt16LE(34), 16, '16 bit');
  assert.equal(wav.toString('ascii', 36, 40), 'data', 'data chunk');
  const dataBytes = wav.readUInt32LE(40);
  assert.equal(dataBytes, wav.length - 44, 'data byte length');
  assert.equal(dataBytes % 2, 0, 'whole PCM16 samples');
  return wav.subarray(44);
}

export function validatePcm(pcm, label = 'sound') {
  const metrics = measurePcm(pcm);
  assert.ok(metrics.nonzeroSamples > 0, `${label}: must not be silent`);
  assert.equal(metrics.clippedSamples, 0, `${label}: no clipped PCM endpoints`);
  assert.ok(metrics.peak > 0 && metrics.peak < 1 && Number.isFinite(metrics.rms), `${label}: finite level`);
  assert.equal(metrics.firstSample, 0, `${label}: first sample must be zero`);
  assert.equal(metrics.lastSample, 0, `${label}: last sample must be zero`);
  assert.ok(metrics.edgeMaxStep <= 0.1, `${label}: first/last 1ms abrupt step ${metrics.edgeMaxStep}`);
  return metrics;
}

/** Sum decoded PCM at unity gain. No limiting, clipping, normalization, or extra preview gain. */
export function measureAuditionMixes(pcmById) {
  return AUDITION_SEQUENCES.map(sequence => {
    const events = sequence.events.map(event => ({ pcm: pcmById.get(event.id), at: event.atFrame * SAMPLE_RATE / 60 }));
    const samples = new Float64Array(Math.max(...events.map(event => event.at + event.pcm.length / 2)));
    for (const event of events) for (let i = 0; i < event.pcm.length / 2; i++) samples[event.at + i] += event.pcm.readInt16LE(i * 2) / 32768;
    let peak = 0, energy = 0;
    for (const sample of samples) {
      assert.ok(Number.isFinite(sample), `${sequence.id}: non-finite mixed sample`);
      peak = Math.max(peak, Math.abs(sample)); energy += sample * sample;
    }
    return { id: sequence.id, gain: 1, peak, rms: Math.sqrt(energy / samples.length),
      durationMs: samples.length / SAMPLE_RATE * 1000, belowUnity: peak < 1 };
  });
}

/** Read-only validation, including full regeneration and exact file-byte comparison. */
export function verifySoundAssets(outputDir = OUTPUT_DIR) {
  const { files, manifest: expectedManifest } = buildSoundAssets();
  const manifestBytes = readFileSync(resolve(outputDir, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const expectedIds = ['hit-lp', 'hit-hp', 'hit-lk', 'hit-hk', 'guard', 'whiff', 'grab-hold', 'grab-impact', 'grab-escape'];
  assert.deepEqual(manifest.sounds.map(sound => sound.id), expectedIds, 'all nine slots in documented audition order');
  assert.deepEqual(manifest.format, { container: 'WAV', encoding: 'PCM', bitsPerSample: 16, channels: 1, sampleRate: SAMPLE_RATE });
  assert.deepEqual(readdirSync(outputDir).filter(file => file.endsWith('.wav')).sort(),
    [...expectedIds.map(id => `${id}.wav`), 'reel.wav'].sort(), 'exact WAV set');
  const sounds = [], pcmById = new Map();
  for (const sound of [...manifest.sounds, manifest.reel]) {
    assert.equal(sound.file, `${sound.id}.wav`, `${sound.id}: local canonical filename`);
    const wav = readFileSync(resolve(outputDir, sound.file)), pcm = readSoundWave(wav), metrics = validatePcm(pcm, sound.id);
    assert.equal(wav.length, sound.bytes, `${sound.id}: byte count`);
    assert.equal(sha256(wav), sound.sha256, `${sound.id}: SHA256`);
    for (const [key, value] of Object.entries(metrics)) assert.equal(sound[key], value, `${sound.id}: recorded ${key}`);
    assert.ok(wav.equals(files.get(sound.file)), `${sound.id}: exact seeded reproduction`);
    pcmById.set(sound.id, pcm);
    sounds.push({ id: sound.id, durationMs: metrics.durationMs, peak: metrics.peak, rms: metrics.rms, edgeMaxStep: metrics.edgeMaxStep });
  }
  assert.deepEqual(manifest, expectedManifest, 'settings and provenance match the pure generator');
  assert.ok(manifestBytes.equals(files.get('manifest.json')), 'manifest reproduces byte-for-byte');
  const mixes = measureAuditionMixes(pcmById);
  for (const mix of mixes) assert.ok(mix.belowUnity, `${mix.id}: 100% linear mixing exceeds range, peak ${mix.peak}`);
  return { sounds, mixes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length > 2) throw new Error('Usage: node scripts/verify-sounds.mjs');
  const results = verifySoundAssets();
  console.table(results.sounds); console.table(results.mixes);
  console.log('PASS: PCM format, metadata, finite/nonzero level, no clipped samples, zero edges, edge steps, SHA256, exact seeded regeneration, five unity-gain linear mixes. Subjective listening remains unverified.');
}

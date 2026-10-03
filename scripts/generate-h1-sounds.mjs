import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SAMPLE_RATE = 48000;
export const OUTPUT_DIR = fileURLToPath(new URL('../assets/audio/h1/s1-v1/', import.meta.url));
export const ASSET_GAIN = 0.8;
export const AUDITION_SEQUENCES = [
  { id: 'combo', label: 'U → I → J', events: [{ id: 'hit-lp', atFrame: 0 }, { id: 'hit-hp', atFrame: 13 }, { id: 'hit-lk', atFrame: 24 }] },
  { id: 'double-hit', label: '강손 동시 타격', events: [{ id: 'hit-hp', atFrame: 0 }, { id: 'hit-hp', atFrame: 0 }] },
  { id: 'throw', label: '붙잡음 → 바닥 충격', events: [{ id: 'grab-hold', atFrame: 0 }, { id: 'grab-impact', atFrame: 36 }] },
  { id: 'escape', label: '붙잡음 → 풀기', events: [{ id: 'grab-hold', atFrame: 0 }, { id: 'grab-escape', atFrame: 12 }] },
  { id: 'instant-escape', label: 'H0 즉시 풀기', events: [{ id: 'grab-escape', atFrame: 0 }] },
];

// These are audition settings, not approved game loudness or combat timings.
const burst = (atMs, attackMs, decayMs) => ({ atMs, attackMs, decayMs });
const noise = (gain, lowHz, highHz, bursts, flutterHz = 0, flutterDepth = 0) =>
  ({ kind: 'noise', gain, lowHz, highHz, bursts, flutterHz, flutterDepth });
const body = (gain, hz, decayMs, atMs = 0) =>
  ({ kind: 'body', gain, hz, bursts: [burst(atMs, 1.1, decayMs)], phaseRadians: 0 });
export const SOUND_PRESETS = [
  { id: 'hit-lp', label: '약손 명중', seed: 104729, durationMs: 105, targetPeak: 0.47,
    description: '짧은 마찰성 타격과 가벼운 몸통 울림', fadeInMs: 3, fadeOutMs: 14,
    layers: [noise(0.9, 700, 7000, [burst(0, 0.5, 11)]), noise(0.55, 140, 1900, [burst(1, 1, 22)]), body(0.42, 158, 20)] },
  { id: 'hit-hp', label: '강손 명중', seed: 130363, durationMs: 165, targetPeak: 0.57,
    description: '약손보다 낮고 두꺼운 짧은 충격', fadeInMs: 3, fadeOutMs: 22,
    layers: [noise(0.76, 600, 5700, [burst(0, 0.7, 15)]), noise(0.82, 75, 1600, [burst(1, 1.8, 37)]), body(0.6, 96, 32), body(0.19, 147, 21)] },
  { id: 'hit-lk', label: '약발 명중', seed: 155921, durationMs: 145, targetPeak: 0.5,
    description: '손보다 넓게 퍼지는 중저음 타격', fadeInMs: 1, fadeOutMs: 20,
    layers: [noise(0.9, 160, 4100, [burst(0, 1.7, 30)]), noise(0.38, 1100, 6800, [burst(2, 0.9, 15)]), body(0.38, 126, 29)] },
  { id: 'hit-hk', label: '강발 명중', seed: 181081, durationMs: 215, targetPeak: 0.62,
    description: '넓은 질감과 낮은 울림이 남는 무거운 발 타격', fadeInMs: 1, fadeOutMs: 30,
    layers: [noise(1, 70, 2900, [burst(0, 1.4, 43)]), noise(0.38, 900, 6100, [burst(1, 0.8, 19)]), body(0.58, 74, 45), body(0.2, 117, 27)] },
  { id: 'guard', label: '방어', seed: 205759, durationMs: 95, targetPeak: 0.44,
    description: '잔향을 줄인 단단하고 짧은 막힘', fadeInMs: 3, fadeOutMs: 13,
    layers: [noise(1, 550, 5900, [burst(0, 0.5, 12)]), noise(0.42, 180, 1600, [burst(1, 0.8, 16)]), body(0.23, 285, 11)] },
  { id: 'whiff', label: '헛침', seed: 230003, durationMs: 150, targetPeak: 0.27,
    description: '충돌음 없이 공기가 짧게 지나가는 질감', fadeInMs: 4, fadeOutMs: 28,
    layers: [noise(1, 420, 4200, [burst(0, 31, 38)]), noise(0.22, 1800, 7500, [burst(13, 20, 23)])] },
  { id: 'grab-hold', label: '붙잡음', seed: 254959, durationMs: 140, targetPeak: 0.32,
    description: '옷깃을 모아 쥐는 짧고 건조한 천 마찰', fadeInMs: 2, fadeOutMs: 22,
    layers: [noise(1, 380, 3500, [burst(0, 6, 16), burst(23, 4, 18), burst(51, 3, 12)], 83, 0.5), noise(0.26, 130, 900, [burst(10, 9, 28)], 47, 0.35)] },
  { id: 'grab-impact', label: '메치기 바닥 충격', seed: 280001, durationMs: 285, targetPeak: 0.64,
    description: '몸이 바닥에 닿는 둔한 충격과 짧은 옷 마찰', fadeInMs: 1.2, fadeOutMs: 42,
    layers: [noise(1, 55, 1550, [burst(0, 2.2, 51), burst(22, 1.7, 25)]), noise(0.38, 700, 5200, [burst(0, 1.4, 22)]), body(0.61, 61, 54), body(0.24, 103, 32), body(0.11, 157, 19, 9)] },
  { id: 'grab-escape', label: '잡기 풀기', seed: 305093, durationMs: 155, targetPeak: 0.36,
    description: '손과 옷이 빠르게 떨어지는 두 번의 짧은 마찰', fadeInMs: 2, fadeOutMs: 24,
    layers: [noise(1, 550, 4600, [burst(0, 5, 17), burst(36, 9, 24)], 67, 0.42), noise(0.3, 1100, 6700, [burst(32, 12, 20)], 113, 0.25)] },
];

const sampleCount = ms => Math.round(ms * SAMPLE_RATE / 1000);
const round = value => Number(value.toFixed(10));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296 * 2 - 1;
  };
}

function envelope(ms, pulses) {
  let level = 0;
  for (const pulse of pulses) {
    const age = ms - pulse.atMs;
    if (age < 0) continue;
    const attack = Math.min(1, age / pulse.attackMs);
    level += attack * Math.exp(-age / pulse.decayMs);
  }
  return level;
}

/** Pure seeded synthesis; no file IO occurs on import or from this function. */
export function synthesizeSound(preset) {
  const samples = new Float64Array(sampleCount(preset.durationMs));
  for (const [index, layer] of preset.layers.entries()) {
    const next = random((preset.seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0);
    const upper = layer.kind === 'noise' ? 1 - Math.exp(-2 * Math.PI * layer.highHz / SAMPLE_RATE) : 0;
    const lower = layer.kind === 'noise' ? 1 - Math.exp(-2 * Math.PI * layer.lowHz / SAMPLE_RATE) : 0;
    let low = 0, high = 0;
    for (let i = 0; i < samples.length; i++) {
      const time = i / SAMPLE_RATE, ms = time * 1000;
      let value;
      if (layer.kind === 'noise') {
        const white = next();
        high += upper * (white - high); low += lower * (white - low);
        const flutter = 1 - layer.flutterDepth / 2 + layer.flutterDepth / 2 * Math.sin(2 * Math.PI * layer.flutterHz * time);
        value = (high - low) * flutter;
      } else {
        value = Math.sin(2 * Math.PI * layer.hz * (time - layer.bursts[0].atMs / 1000) + layer.phaseRadians);
      }
      samples[i] += value * layer.gain * envelope(ms, layer.bursts);
    }
  }
  // A 25 Hz one-pole DC blocker precedes the whole-file edge fades and peak scaling.
  const dcPole = Math.exp(-2 * Math.PI * 25 / SAMPLE_RATE);
  const fadeInSamples = sampleCount(preset.fadeInMs), fadeOutSamples = sampleCount(preset.fadeOutMs);
  let previousIn = 0, previousOut = 0, rawPeak = 0;
  for (let i = 0; i < samples.length; i++) {
    const input = samples[i], filtered = input - previousIn + dcPole * previousOut;
    previousIn = input; previousOut = filtered;
    const attack = Math.sin(Math.min(1, i / fadeInSamples) * Math.PI / 2) ** 2;
    const release = Math.sin(Math.min(1, (samples.length - 1 - i) / fadeOutSamples) * Math.PI / 2) ** 2;
    samples[i] = filtered * attack * release;
    if (!Number.isFinite(samples[i])) throw new Error(`${preset.id}: non-finite synthesis sample ${i}`);
    rawPeak = Math.max(rawPeak, Math.abs(samples[i]));
  }
  if (!(rawPeak > 0) || !(preset.targetPeak > 0 && preset.targetPeak < 1)) throw new Error(`${preset.id}: invalid peak or silent synthesis`);
  const gain = preset.targetPeak / rawPeak * ASSET_GAIN;
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return { samples, rawPeak, gain, fadeInSamples, fadeOutSamples };
}

export function encodeWave(samples) {
  const pcm = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];
    if (!Number.isFinite(value) || Math.abs(value) >= 1) throw new Error(`Invalid or clipped source sample ${i}`);
    pcm.writeInt16LE(Math.round(value * 32767), i * 2);
  }
  return wrapPcm(pcm);
}

function wrapPcm(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(SAMPLE_RATE, 24); header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function measurePcm(pcm) {
  const count = pcm.length / 2;
  let peak = 0, energy = 0, total = 0, clippedSamples = 0, nonzeroSamples = 0, edgeMaxStep = 0;
  for (let i = 0; i < count; i++) {
    const integer = pcm.readInt16LE(i * 2), sample = integer / 32768;
    peak = Math.max(peak, Math.abs(sample)); energy += sample * sample; total += sample;
    if (integer === -32768 || integer === 32767) clippedSamples++;
    if (integer !== 0) nonzeroSamples++;
    if (i > 0 && (i < 48 || i >= count - 48)) edgeMaxStep = Math.max(edgeMaxStep, Math.abs(integer - pcm.readInt16LE((i - 1) * 2)) / 32768);
  }
  return { sampleCount: count, durationMs: count / SAMPLE_RATE * 1000, peak: round(peak), rms: round(Math.sqrt(energy / count)),
    dcMean: round(total / count), firstSample: pcm.readInt16LE(0), lastSample: pcm.readInt16LE(pcm.length - 2),
    clippedSamples, nonzeroSamples, edgeMaxStep: round(edgeMaxStep) };
}

/** Returns every expected byte, permitting regeneration checks without touching disk. */
export function buildSoundAssets() {
  const files = new Map(), sounds = [];
  for (const preset of SOUND_PRESETS) {
    const result = synthesizeSound(preset), wav = encodeWave(result.samples), file = `${preset.id}.wav`;
    files.set(file, wav);
    sounds.push({ id: preset.id, label: preset.label, file, description: preset.description, ...measurePcm(wav.subarray(44)),
      bytes: wav.length, sha256: sha256(wav), seed: preset.seed, settings: preset,
      fade: { curve: 'sine-squared', inMs: preset.fadeInMs, outMs: preset.fadeOutMs,
        inSamples: result.fadeInSamples, outSamples: result.fadeOutSamples },
      normalization: { method: 'one scalar peak gain times rendered asset gain; no limiter or clipping',
        targetPeakBeforeAssetGain: preset.targetPeak, renderedAssetGain: ASSET_GAIN,
        rawPeak: round(result.rawPeak), gain: round(result.gain) } });
  }
  const gapMs = 420, leadingMs = 240, trailingMs = 240;
  const pieces = [Buffer.alloc(sampleCount(leadingMs) * 2)], sequence = [];
  let offset = sampleCount(leadingMs);
  for (const [index, sound] of sounds.entries()) {
    const pcm = files.get(sound.file).subarray(44);
    sequence.push({ id: sound.id, startMs: offset / SAMPLE_RATE * 1000, durationMs: sound.durationMs });
    pieces.push(pcm); offset += sound.sampleCount;
    if (index < sounds.length - 1) { pieces.push(Buffer.alloc(sampleCount(gapMs) * 2)); offset += sampleCount(gapMs); }
  }
  pieces.push(Buffer.alloc(sampleCount(trailingMs) * 2));
  const reel = wrapPcm(Buffer.concat(pieces)); files.set('reel.wav', reel);
  const manifest = {
    version: 's1-v1', status: 'audition draft; subjective listening and game settings are not approved',
    format: { container: 'WAV', encoding: 'PCM', bitsPerSample: 16, channels: 1, sampleRate: SAMPLE_RATE },
    generator: { script: 'scripts/generate-h1-sounds.mjs', algorithm: 'h1-dry-impact-v1',
      source: 'original procedural synthesis; no external recordings, music, or voices',
      noise: 'xorshift32 (13,17,5); layer seed = sound seed XOR imul(layerIndex+1,0x9e3779b9); uniform [-1,1)',
      band: 'parallel one-pole lowpasses at highHz and lowHz; output = high-band lowpass minus low-band lowpass',
      envelope: 'sum of min(1,age/attackMs) * exp(-age/decayMs), each burst after atMs',
      dcBlockHz: 25, quantization: 'round(sample * 32767); reject non-finite or abs(sample)>=1',
      edgeInspection: 'maximum adjacent-sample step within first/last 48 samples (1ms); not a listening-quality result' },
    headroomRevision: { reason: 'Initial in-memory same-file strong-punch pair exceeded unity at 100% linear mixing.',
      initialStrongPunchPeak: 0.5699768066, initialDoubleStrongPunchPeak: 1.1399536132,
      renderedAssetGain: ASSET_GAIN, scope: 'All nine rendered WAVs scaled equally; relative levels preserved; no hidden UI gain or limiter.' },
    edgeRevision: { reason: 'Initial first-1ms adjacent-sample steps exceeded the draft 0.1 bound in three files.',
      initialSteps: { 'hit-lp': 0.2222595215, 'hit-hp': 0.1560058594, guard: 0.2164001465 },
      revisedFadeInMs: { 'hit-lp': 3, 'hit-hp': 3, guard: 3 },
      limitation: 'A numerical onset bound and zero endpoints do not establish absence of audible clicks.' },
    audition: { framesPerSecond: 60, gain: 1, mixing: 'linear sum without limiter', sequences: AUDITION_SEQUENCES,
      note: 'Audition event spacing, not game integration or a gameplay success test. Final game loudness remains undecided.' },
    sounds,
    reel: { id: 'reel', label: '9종 순서 비교', file: 'reel.wav', ...measurePcm(reel.subarray(44)), bytes: reel.length,
      sha256: sha256(reel), leadingMs, gapMs, trailingMs, sequence,
      note: 'Sequential audition at original file levels; no overlapping mix or game event timing.' },
  };
  files.set('manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  return { files, manifest };
}

export function generateSoundAssets(outputDir = OUTPUT_DIR, check = false) {
  const { files, manifest } = buildSoundAssets();
  if (!check) mkdirSync(outputDir, { recursive: true });
  for (const [file, expected] of files) {
    const destination = resolve(outputDir, file);
    if (check) {
      if (!readFileSync(destination).equals(expected)) throw new Error(`Reproduction differs: ${file}`);
    } else writeFileSync(destination, expected);
  }
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--check')) throw new Error('Usage: node scripts/generate-h1-sounds.mjs [--check]');
  const check = args.includes('--check'), manifest = generateSoundAssets(OUTPUT_DIR, check);
  console.log(`${check ? 'Reproduced byte-for-byte' : 'Generated'} ${manifest.sounds.length} audition sounds + reel + manifest in ${OUTPUT_DIR}`);
}

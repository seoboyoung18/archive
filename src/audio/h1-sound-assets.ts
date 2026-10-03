import manifest from '../../assets/audio/h1/s1-v1/manifest.json';

const urls = import.meta.glob('../../assets/audio/h1/s1-v1/*.wav', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export const H1_SOUND_ASSETS = manifest.sounds.map(sound => ({ id: sound.id, label: sound.label,
  url: urls[`../../assets/audio/h1/s1-v1/${sound.file}`] }));

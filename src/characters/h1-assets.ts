import { H1_POSES } from './h1-poses.ts';

const files = import.meta.glob<string>([
  '../../assets/characters/h1/derived/v2/*.png',
  '../../assets/characters/h1/derived/movement-v1/*.png',
  '../../assets/characters/h1/derived/combat-v1/*.png',
  '../../assets/characters/h1/derived/motion-v1/*.png',
  '../../assets/characters/h1/derived/walk-v2/*.png',
  '../../assets/characters/h1/derived/attack-motion-v1/*.png',
  '../../assets/characters/h1/derived/opposite-limbs-v1/*.png',
  '../../assets/characters/h1/derived/grab-v1/*.png',
  '../../assets/characters/h1/derived/throw-v1/*.png',
], { eager: true, query: '?url', import: 'default' });

/** Both combat and match inspectors load the same current pose set. */
export const H1_ASSETS = Object.entries(H1_POSES).map(([key, path]) => ({ key,
  url: files[`../../assets/characters/h1/derived/${path}`] }));

import type Phaser from 'phaser';
import type { CombatState } from '../combat/combat.ts';

// Covers the selected H1 artwork and the original throw arc (maximum 191.645576927px).
export const H1_CAMERA_MARGIN = 192;

export interface CombatCamera {
  left: number; right: number; zoom: number; offsetX: number; scrollX: number; scrollY: number;
}

/** Camera framing depends only on logical roots, never on the current pose or render time. */
export function combatCamera(combat: Pick<CombatState, 'fighters'>): CombatCamera {
  const roots = combat.fighters.map(f => f.x);
  const left = Math.min(...roots) - H1_CAMERA_MARGIN, right = Math.max(...roots) + H1_CAMERA_MARGIN;
  const zoom = Math.min(1, 1280 / (right - left));
  const screenLeft = 640 + (left - 640) * zoom, screenRight = 640 + (right - 640) * zoom;
  const offsetX = Math.max(-screenLeft, Math.min(1280 - screenRight, 0));
  return { left, right, zoom, offsetX, scrollX: -offsetX / zoom, scrollY: 0 };
}

export function worldToScreen(camera: CombatCamera, x: number, y: number): { x: number; y: number } {
  return { x: 640 + (x - 640) * camera.zoom + camera.offsetX, y: 600 + (y - 600) * camera.zoom };
}

/** Phaser 4 Camera.preRender applies origin + zoom * (world - scroll - origin). */
export function applyCombatCamera(camera: Phaser.Cameras.Scene2D.Camera, framing: CombatCamera): void {
  camera.setOrigin(.5, 600 / 720).setRoundPixels(false).setZoom(framing.zoom).setScroll(framing.scrollX, framing.scrollY);
}

/** The HUD has its own identity camera; scrollFactor=0 alone would still inherit world zoom. */
export function configureCombatCameras(
  scene: Phaser.Scene,
  worldObjects: readonly Phaser.GameObjects.GameObject[],
  hudObjects: readonly Phaser.GameObjects.GameObject[],
): { world: Phaser.Cameras.Scene2D.Camera; hud: Phaser.Cameras.Scene2D.Camera } {
  const world = scene.cameras.main.setName('combat-world');
  const hud = scene.cameras.add(0, 0, 1280, 720, false, 'combat-hud');
  hud.setBackgroundColor('rgba(0,0,0,0)').setZoom(1).setScroll(0, 0).setRoundPixels(false);
  world.ignore([...hudObjects]); hud.ignore([...worldObjects]);
  return { world, hud };
}

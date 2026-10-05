import type { ScreenSize } from './detect';
import type { Chord } from './input';

export interface TouchButton {
  label: string;
  code: number;
}

/** Optional per-game tweaks. Only compatibility metadata, never game content. */
export interface GamePreset {
  screen?: ScreenSize;
  /** Extra KeyboardEvent.code → phone key bindings. */
  keys?: Record<string, number>;
  keyHelp?: Array<[string, string]>;
  /** Big action buttons shown next to the d-pad on touch screens. */
  touchActions?: TouchButton[];
  chords?: Chord[];
  repressHeldDirections?: boolean;
}

interface PresetEntry {
  name: string;
  vendor?: string;
  preset: GamePreset;
}

const PRESETS: PresetEntry[] = [
  {
    name: 'Forgotten Warrior',
    preset: {
      screen: { width: 176, height: 220 },
      keys: { KeyZ: 53, KeyX: 50, KeyA: 55, KeyS: 57, KeyD: 48 },
      keyHelp: [
        ['←/→ или 4/6', 'Ходьба'],
        ['X или 2', 'Прыжок (на бегу — в сторону движения)'],
        ['Z или 5', 'Удар'],
        ['A или 7', 'Зелье HP'],
        ['S или 9', 'Зелье MP'],
        ['D или 0', 'Спецудар'],
        ['↑/↓', 'Лестницы и пещеры'],
      ],
      touchActions: [
        { label: 'Удар', code: 53 },
        { label: 'Прыжок', code: 50 },
        { label: 'HP', code: 55 },
        { label: 'MP', code: 57 },
        { label: 'Супер', code: 48 },
      ],
      chords: [
        { held: -3, pressed: 50, send: 49 },
        { held: -4, pressed: 50, send: 51 },
        { held: 52, pressed: 50, send: 49 },
        { held: 54, pressed: 50, send: 51 },
      ],
      repressHeldDirections: true,
    },
  },
];

export function findPreset(name: string, vendor: string): GamePreset {
  const entry = PRESETS.find((p) => p.name === name && (!p.vendor || p.vendor === vendor));
  return entry?.preset ?? {};
}

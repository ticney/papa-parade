import type { LevelContent } from '@content/contentBundle';
import { log } from '@shared/log';

/**
 * Debug builds only: `?threats=off` loads the level with its planned threats removed, so a test
 * that an outlet cycle would disturb (exact cue sequences, the baby's wander) sees a quiet room.
 * Any other value is ignored with a warning. True when the threats are to be stripped.
 */
export function readThreatsOff(search: string): boolean {
  const raw = new URLSearchParams(search).get('threats');
  if (raw === null) return false;
  if (raw === 'off') return true;
  log.warn('boot', `ignoring ?threats=${raw}: the only value is "off"`);
  return false;
}

/**
 * The same level with no wave and no def: still a valid `LevelContent` for `createSim`. The
 * duration stays, so the timer still runs and the level still ends.
 */
export function withoutThreats(content: LevelContent): LevelContent {
  return { level: { ...content.level, waves: [] }, threats: {} };
}

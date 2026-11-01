import { SNAKE_ID_PATTERN } from '@content/levelNodeNames';
import { PLAY_SPEED_MAX, UINT32_RANGE } from '@shared/constants';
import { log } from '@shared/log';

/**
 * The debug URL parameters of a page, each `null` (or `false`) when absent or invalid. Plain
 * values only: the client does not know the bot ids, `installAutoplay` validates the name.
 */
export interface DebugParams {
  /** `?debug=1`. */
  readonly isDebug: boolean;
  /** `?autoplay=<bot>`: the name of the bot that plays instead of the player. */
  readonly autoplay: string | null;
  /** `?seed=<n>`: the seed of every level started in the page. */
  readonly seed: number | null;
  /** `?speed=<x>`: the multiplier of the real time the level loop measures. */
  readonly speed: number | null;
  /** `?level=<id>` (story 4.10): the level to play, of a valid shape; `resolveLevelParam` checks it exists. */
  readonly level: string | null;
}

/**
 * Reads `?debug`, `?autoplay`, `?seed`, `?speed` and `?level`. A bad value is ignored with one `warn` that
 * says what is accepted (the pattern of `readThreatsOff`). Only called when
 * `VITE_DEBUG_ALLOWED === 'true'`: a production build does not even read them.
 */
export function readDebugParams(search: string): DebugParams {
  const query = new URLSearchParams(search);

  let isDebug = false;
  const debug = query.get('debug');
  if (debug === '1') isDebug = true;
  else if (debug !== null) log.warn('boot', `ignoring ?debug=${debug}: the only value is "1"`);

  let autoplay: string | null = null;
  const autoplayRaw = query.get('autoplay');
  if (autoplayRaw === '') log.warn('boot', 'ignoring ?autoplay=: name a bot');
  else autoplay = autoplayRaw;

  let seed: number | null = null;
  const seedRaw = query.get('seed');
  if (seedRaw !== null) {
    const value = /^\d+$/.test(seedRaw) ? Number(seedRaw) : Number.NaN;
    if (Number.isInteger(value) && value < UINT32_RANGE) seed = value;
    else log.warn('boot', `ignoring ?seed=${seedRaw}: not an integer in [0, ${UINT32_RANGE})`);
  }

  let speed: number | null = null;
  const speedRaw = query.get('speed');
  if (speedRaw !== null) {
    const value = speedRaw.trim() === '' ? Number.NaN : Number(speedRaw);
    if (Number.isFinite(value) && value > 0 && value <= PLAY_SPEED_MAX) speed = value;
    else log.warn('boot', `ignoring ?speed=${speedRaw}: not a number in (0, ${PLAY_SPEED_MAX}]`);
  }

  let level: string | null = null;
  const levelRaw = query.get('level');
  if (levelRaw !== null) {
    if (SNAKE_ID_PATTERN.test(levelRaw)) level = levelRaw;
    else log.warn('boot', `ignoring ?level=${levelRaw}: a level id is lower_snake_case`);
  }

  return { isDebug, autoplay, seed, speed, level };
}

/**
 * The level `?level=` asks for, if there is one: an id with no level file is ignored with one `warn`,
 * and the default level plays (a mistyped link must not end on the Oops screen). Null: no choice made.
 */
export function resolveLevelParam(
  level: string | null,
  isBundled: (id: string) => boolean,
): string | null {
  if (level === null || isBundled(level)) return level;
  log.warn('boot', `ignoring ?level=${level}: no such level`);
  return null;
}

/**
 * Whether `window.__PP__` is installed: never in a production build (`VITE_DEBUG_ALLOWED` false),
 * always in dev, and in a playtest build only on a page opened with `?debug=1`.
 */
export function isTestApiEnabled(flags: {
  readonly isDebugAllowed: boolean;
  readonly isDev: boolean;
  readonly isDebug: boolean;
}): boolean {
  return flags.isDebugAllowed && (flags.isDev || flags.isDebug);
}

import { log } from '@shared/log';

/**
 * Dev and playtest builds only (story 7.12, D13): `?bubble=off` keeps Papa's activity bubble undrawn for the
 * whole session, so that Geo can show testers extracts where only Papa's body says what he does (the indicator
 * « Papa se lit sans sa bulle »). Nothing else changes. Any other value is ignored with a warning. True when the
 * bubble is to stay hidden. Not a setting, never saved.
 */
export function readBubbleOff(search: string): boolean {
  const raw = new URLSearchParams(search).get('bubble');
  if (raw === null) return false;
  if (raw === 'off') return true;
  log.warn('boot', `ignoring ?bubble=${raw}: the only value is "off"`);
  return false;
}

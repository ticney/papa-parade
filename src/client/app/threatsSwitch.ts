import type { LevelContent } from '@content/contentBundle';
import type { ThreatDef } from '@content/schemas/threat';
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
 * The same level with no wave, no wave def and no disruption def (the waves are emptied, so nothing
 * plans a phone either): still a valid `LevelContent` for `createSim`. The
 * duration stays, so the timer still runs and the level still ends. The level's gauges stay, and
 * the micro-sleep def with them (story 1.19: `createSim` refuses a fatigue gauge whose def is not
 * loaded), the cry in the arms of a level that carries (story 4.1) and the threats the duel steps of
 * its sequences spawn (story 4.6: the sequences stay, so their defs do). So a run of more than about 150 s (fatigue crosses its threshold at 140 s) still sees
 * micro-sleeps: the switch is quiet for the short runs the tests make, not for a whole level.
 */
export function withoutThreats(content: LevelContent): LevelContent {
  const microSleepDef = content.level.gauges.fatigue?.microSleepDef;
  const microSleep =
    microSleepDef !== undefined && Object.hasOwn(content.threats, microSleepDef)
      ? { [microSleepDef]: content.threats[microSleepDef] as ThreatDef }
      : {};
  if (microSleepDef !== undefined && !Object.hasOwn(content.threats, microSleepDef)) {
    log.warn('boot', `?threats=off: the micro-sleep def "${microSleepDef}" is not loaded`);
  }
  // The cry in the arms of a level that carries is kept the same way (story 4.1): `createSim` refuses a
  // carry whose def is not loaded, and it only ever comes while the baby is carried.
  const armsCryDef = content.level.carry?.armsCryDef;
  const armsCry =
    armsCryDef !== undefined && Object.hasOwn(content.threats, armsCryDef)
      ? { [armsCryDef]: content.threats[armsCryDef] as ThreatDef }
      : {};
  if (armsCryDef !== undefined && !Object.hasOwn(content.threats, armsCryDef)) {
    log.warn('boot', `?threats=off: the cry-in-the-arms def "${armsCryDef}" is not loaded`);
  }
  // The threat a `duel` step spawns on Papa stays with its sequence (story 4.6): `createSim` refuses a
  // duel whose def is not loaded.
  const duelThreats: Record<string, ThreatDef> = {};
  for (const sequence of Object.values(content.sequences)) {
    for (const step of sequence.steps) {
      if (step.kind !== 'duel') continue;
      if (Object.hasOwn(content.threats, step.threatDef)) {
        duelThreats[step.threatDef] = content.threats[step.threatDef] as ThreatDef;
      } else {
        log.warn('boot', `?threats=off: the duel def "${step.threatDef}" is not loaded`);
      }
    }
  }
  return {
    level: { ...content.level, waves: [] },
    threats: { ...microSleep, ...armsCry, ...duelThreats },
    disruptions: {},
    // The level's sequences stay: a debug start still works with no wave (story 4.4).
    sequences: content.sequences,
  };
}

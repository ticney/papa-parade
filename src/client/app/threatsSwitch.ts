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
 * loaded), the cry in the arms of a level that carries (story 4.1), the pot each chore turns into when it is
 * abandoned (story 9.5: `createSim` refuses a chore whose pot def is not loaded; it only ever comes when the
 * cooking is left alone) and the threats the duel steps of
 * its sequences spawn (story 4.6: the sequences stay, so their defs do), and the two alerts of a stealth step (story 4.9). So a run of more than about 150 s (fatigue crosses its threshold at 140 s) still sees
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
  // Likewise the two alerts a `stealth` step spawns on the baby (story 4.9).
  const duelThreats: Record<string, ThreatDef> = {};
  const keep = (defId: string, role: string): void => {
    if (Object.hasOwn(content.threats, defId)) {
      duelThreats[defId] = content.threats[defId] as ThreatDef;
    } else {
      log.warn('boot', `?threats=off: the ${role} def "${defId}" is not loaded`);
    }
  };
  for (const sequence of Object.values(content.sequences)) {
    for (const step of sequence.steps) {
      if (step.kind === 'duel') keep(step.threatDef, 'duel');
      else if (step.kind === 'stealth') {
        keep(step.falseAlarmDef, 'false alarm');
        keep(step.realWakeDef, 'real wake');
      }
    }
  }
  // The pot of an abandoned chore (story 9.5) stays with its chore, like the others.
  for (const chore of content.chores ?? []) {
    if (chore.abandonedThreat !== undefined) keep(chore.abandonedThreat.def, 'abandoned chore');
  }
  return {
    level: { ...content.level, waves: [] },
    threats: { ...microSleep, ...armsCry, ...duelThreats },
    disruptions: {},
    // The level's sequences stay: a debug start still works with no wave (story 4.4).
    sequences: content.sequences,
    // So do its house chores (story 9.4): a station is no threat, and `createSim` refuses one whose def is lost.
    ...(content.chores === undefined ? {} : { chores: content.chores }),
  };
}

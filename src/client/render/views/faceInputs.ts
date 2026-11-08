import { isDuelStepRunning, isStealthStepRunning, type World } from '@sim';

// What the faces read from the world (story 7.10): the baby's focus, the guard of the signals, Papa's
// fatigue. Pure, no Three, so that a headless test reads the faces as the scene does. Only what the player
// sees: a threat's state (its marker, its ring), never a timing field.

/**
 * The baby is focused (D6): he is locked on, or crawling to, a threat whose marker is shown (`telegraph` or
 * `windowOpen`). Never in `mischiefSilent`, never for a `hidden` threat, never before its telegraph.
 * Allocates nothing.
 */
export function babyFocusOf(world: Readonly<World>): boolean {
  const { baby } = world;
  if (baby.state !== 'targetLocked' && baby.state !== 'approach') return false;
  if (baby.targetThreatId === null) return false;
  for (let i = 0; i < world.threats.length; i++) {
    const threat = world.threats[i] as World['threats'][number];
    if (threat.id !== baby.targetThreatId) continue;
    return threat.state === 'telegraph' || threat.state === 'windowOpen';
  }
  return false;
}

/**
 * Only the signals count (D5, principle 5): a `duel` step (the bedtime duel, the bomb drop, the fake sleep's
 * feints) or a `stealth` step (the false alerts) runs. Both faces are then at rest.
 */
export function isSignalOnly(world: Readonly<World>): boolean {
  return isDuelStepRunning(world as World) || isStealthStepRunning(world as World);
}

/** Papa is tired (D7): his fatigue strictly above the gameplay threshold, the sim's own `>`. */
export function isPapaTired(world: Readonly<World>): boolean {
  return world.gauges.fatigue > world.feel.fatigue.thresholdPoints;
}

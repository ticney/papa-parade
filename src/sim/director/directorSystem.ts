import type { StepContext } from '../context.ts';
import { telegraphThreat } from '../threats/threatFsm.ts';
import type { ThreatInstance, World } from '../world.ts';

/**
 * System: the minimal director (story 1.10 D12; story 1.18's wave director replaces this policy).
 * At most once per step, when the baby is free (`wander` or `babble`) and no threat is active, it
 * targets the first idle threat of the level whose `fromMs` has passed: the threat is telegraphed.
 * No randomness: it is the same for every seed. A threat that was answered may be targeted again
 * once its cooldown has re-armed it.
 */
export function runDirector(world: World, ctx: StepContext): void {
  const { baby, threats } = world;
  if (baby.state !== 'wander' && baby.state !== 'babble') return;
  for (let i = 0; i < threats.length; i++) {
    const state = (threats[i] as ThreatInstance).state;
    if (state === 'telegraph' || state === 'windowOpen') return;
  }
  const now = world.time.sim;
  for (let i = 0; i < threats.length; i++) {
    const threat = threats[i] as ThreatInstance;
    const entry = ctx.level.threats[i];
    if (entry === undefined || threat.state !== 'idle' || now < entry.fromMs) continue;
    telegraphThreat(world, ctx, threat, entry.def);
    return;
  }
}

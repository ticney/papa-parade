import { isBabyCarried } from '../baby/babyFsm.ts';
import type { StepContext } from '../context.ts';
import { gagIdOf, isNearMissGag } from '../threats/gags.ts';
import type { ThreatInstance, World } from '../world.ts';

/**
 * The near misses frozen on the end photo (story 3.6, D2). When the level ends, each threat whose gag
 * is a near miss and which stands on an anchor counts once if the baby, not carried, is within
 * `feel.endOfLevel.frozenNearMissReachM` of its point (squared distance, no square root). The threat's
 * state does not matter: the photo shows where the baby is, not what a threat is doing. The game has no
 * height, no climbing and no shelf, so « the baby at the top of the stairs » stands in for the GDD's
 * « bébé en haut de l'étagère »; a future shelf threat joins by adding its gag to the table.
 *
 * Each one adds one to `world.score.nearMisses` (Mama's « Hurlement » counts it through
 * `computeMamaScore`) and emits `NearMissFrozen`, a different event from `NearMiss` so that a moment of
 * play is not mistaken for it. No sound, no gag and no `world.rng` draw; it keeps no state.
 * `endLevel` calls it right after `LevelEnded` and before `scoreLevel`, whatever the end.
 */
export function recordFrozenNearMisses(world: World, ctx: StepContext): void {
  if (isBabyCarried(world)) return;
  const { frozenNearMissReachM } = ctx.feel.endOfLevel;
  const reachSquaredM2 = frozenNearMissReachM * frozenNearMissReachM;
  const { xM: babyXM, zM: babyZM } = world.baby;
  const { threats } = ctx.level;
  for (let i = 0; i < threats.length; i++) {
    const { def } = threats[i] as (typeof threats)[number];
    if (def.target !== 'anchor') continue;
    const gag = gagIdOf(def.gag);
    if (!isNearMissGag(gag)) continue;
    const threat = world.threats[i] as ThreatInstance;
    const dxM = babyXM - threat.xM;
    const dzM = babyZM - threat.zM;
    if (dxM * dxM + dzM * dzM > reachSquaredM2) continue;
    world.score.nearMisses += 1;
    ctx.events.push({ type: 'NearMissFrozen', t: world.time.sim, threatId: threat.id, gag });
  }
}

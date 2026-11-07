import { GAUGE_MAX_POINTS, MS_PER_S, STEP_MS } from '@shared/constants';
import type { StepContext } from '../context.ts';
import type { CatastropheSource } from '../events.ts';
import { activeDifficulty } from '../timing/difficulty.ts';
import type { World } from '../world.ts';

/**
 * Whether the gauge is frozen: during the final rush the door is already open and Mama is on her way
 * in, so nothing moves it any more (story 3.16 D4, GDD mechanic 14). The `sequence` state is live: a
 * sequence's gags count.
 */
function isCatastropheFrozen(world: World): boolean {
  return world.flow.state === 'finalRush';
}

/**
 * Holds the gauge in `[0, 100]` and returns the change that actually happened (after the clamp).
 * Reaching 0 or 100 is gameplay, not a bug (the noise gauge's rule, story 3.1 D6): the clamp is silent.
 */
function moveCatastrophe(world: World, deltaPct: number): number {
  const { gauges } = world;
  const before = gauges.catastrophePct;
  gauges.catastrophePct = Math.min(GAUGE_MAX_POINTS, Math.max(0, before + deltaPct));
  return gauges.catastrophePct - before;
}

/**
 * The only writer of `world.gauges.catastrophePct` with `decayCatastrophe` (story 3.16, the
 * `addNoise` pattern): every gag, every perfect and the debug `SetCatastrophe` come through here.
 * The gauge is frozen in the final rush, so it does nothing there. When the value really changed it
 * emits `CatastropheChanged{source, catastrophePct, deltaPct}`, where `deltaPct` is the change after
 * the clamp; a change of 0 (already at 100, a `none` category, a 0 tuning) emits nothing.
 */
export function addCatastrophe(
  world: World,
  ctx: StepContext,
  deltaPct: number,
  source: CatastropheSource,
): void {
  if (isCatastropheFrozen(world)) return;
  const change = moveCatastrophe(world, deltaPct);
  if (change === 0) return;
  ctx.events.push({
    type: 'CatastropheChanged',
    t: world.time.sim,
    source,
    catastrophePct: world.gauges.catastrophePct,
    deltaPct: change,
  });
}

/**
 * The gauge's own fall, `deltaPct` negative or 0, with no event: a fall every 10 ms step would be
 * 100 events a second in every journal (the `decayNoise` rule, story 3.1 D5). Readers that need the
 * exact value read `world.gauges.catastrophePct`.
 */
export function decayCatastrophe(world: World, deltaPct: number): void {
  if (isCatastropheFrozen(world)) return;
  moveCatastrophe(world, deltaPct);
}

/** The index of a threat in `world.threats` (and `ctx.level.threats`), or -1. */
function threatIndexOf(world: World, threatId: number): number {
  for (let i = 0; i < world.threats.length; i++) {
    if (world.threats[i]?.id === threatId) return i;
  }
  return -1;
}

/**
 * The catastrophe gauge for one step (story 3.16, FR73; architecture's `catastrophe.ts`). In every
 * level, outside the final rush. In order:
 *
 * 1. the decay, `decayPerSec` for one step of sim time (silent: no event);
 * 2. the events of **this step** (`t === now`, scanned from the end like `runNoise`, with no
 *    allocation), the perfect drops first, then the rises, each in emission order: a perfect
 *    `ResponseResolved` lowers the gauge by `perfectDropPct` (not multiplied), a `GagTriggered`
 *    raises it by `risePct` of the threat def's `catastrophe` category times the tier's
 *    `catastropheMultiplier`. A success or a lullaby beat does nothing. The beats of a house chore
 *    (story 9.4) count like responses: a `ChoreBeatJudged{perfect}` lowers the gauge by
 *    `perfectDropPct`, a `ChoreBeatJudged{fail}` raises it by `risePct.choreBeat` times the
 *    multiplier (source `choreBeat`), in emission order with the gags.
 *
 * It reads events and the threat's def, never the threats' state. The threats never call the gauge
 * (architecture L233): it runs with the gauges, before the score and the flow, which read it in the
 * same step. At 100 % `runFlow` ends the level on `mamaHome`.
 */
export function runCatastrophe(world: World, ctx: StepContext): void {
  if (isCatastropheFrozen(world)) return;
  const { risePct, decayPerSec, perfectDropPct } = ctx.feel.catastrophe;
  decayCatastrophe(world, (-decayPerSec * STEP_MS) / MS_PER_S);

  const now = world.time.sim;
  const { events } = ctx;
  // `CatastropheChanged` events pushed below sit past `end` and are never scanned.
  const end = events.length;
  let start = end;
  while (start > 0 && events[start - 1]?.t === now) start--;
  // The step's drops first, then its rises: the gauge is clamped at each move, so the order decides
  // whether a step that holds both ends the level, and it must not depend on the threats' index
  // (story 3.16 review, Geo).
  for (let i = start; i < end; i++) {
    const event = events[i];
    if (
      (event?.type === 'ResponseResolved' || event?.type === 'ChoreBeatJudged') &&
      event.quality === 'perfect'
    ) {
      addCatastrophe(world, ctx, -perfectDropPct, 'perfect');
    }
  }
  for (let i = start; i < end; i++) {
    const event = events[i];
    // A missed beat of a house chore (story 9.4, D9): `risePct.choreBeat`, like a gag's category.
    if (event?.type === 'ChoreBeatJudged') {
      if (event.quality === 'fail') {
        const multiplier = activeDifficulty(world, ctx).catastropheMultiplier;
        addCatastrophe(world, ctx, risePct.choreBeat * multiplier, 'choreBeat');
      }
      continue;
    }
    if (event?.type !== 'GagTriggered') continue;
    const index = threatIndexOf(world, event.threatId);
    const category = index < 0 ? undefined : ctx.level.threats[index]?.def.catastrophe;
    if (category === undefined || category === 'none') continue;
    const multiplier = activeDifficulty(world, ctx).catastropheMultiplier;
    addCatastrophe(world, ctx, risePct[category] * multiplier, category);
  }
}

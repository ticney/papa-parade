import { STEP_MS } from '@shared/constants';
import { createRng, nextFloat } from '@shared/rng';
import { asSimMs } from '@shared/time';
import type { SimCommand, ThreatInstance, World } from '@sim';
import type { Bot, BotResponse, BotSetup } from './bot.ts';
import { botSeed } from './botSeed.ts';
import { createCommandScheduler } from './commandScheduler.ts';
import { nextGaussian } from './gaussian.ts';
import {
  centreOf,
  createCycleDropMemory,
  createCycleMemory,
  createFirmHold,
  createSilenceMemory,
  createStealthWalkMemory,
  createTidyMemory,
  HAS_CHRONO_RING,
  isPressable,
  planCycleDrop,
  planStealthWalk,
  planTidy,
  responseOf,
  scheduleDrop,
  schedulePress,
} from './threatTiming.ts';

/** Papa's states in which his hands are full: a threat first seen then is easily missed (D3 of story 3.14). */
const BUSY_PAPA_STATES: ReadonlySet<string> = new Set(['asleep', 'drink', 'onPhone', 'onToilet']);

/**
 * A plausible player (story 3.14). **The reaction.** Everything it answers to a sight or a signal waits for a
 * reaction time, drawn once per response planned: `max(reactionMinMs, reactionMeanMs + reactionSdMs × N(0, 1))`
 * in whole ms (no draw when `reactionSdMs` is 0). **The aim.** On a response that shows a chrono-ring (`parry`,
 * `firm`, the bomb drop's release: `HAS_CHRONO_RING`) it aims at `centre + readError.<mode>.offsetMs +
 * readError.<mode>.sdMs × N(0, 1)`, where `<mode>` is `withChronoRing` if `setup.isChronoRingShown` and
 * `withoutChronoRing` if not: reading the time left off a ring is far more precise than guessing it. On a
 * response with no ring (a lullaby beat, a `wait` signal, a held breath) the error is `aimOffsetMs` /
 * `jitterSdMs`. **The inattention.** A threat it first sees while busy elsewhere (its finger is down or an
 * answer is planned and not yet sent, the baby's find is pending, Papa is asleep, drinking, on the phone or
 * on the toilet) is never answered in that cycle with probability `missWhileBusyPct` %, one draw per such
 * decision; a threat first seen while free is always answered.
 *
 * When it first sees a telegraph it plans one press at
 * `max(telegraph + reaction, centre + that aim)`, in whole ms: the reaction time is a floor (nobody presses
 * before having seen the telegraph), the error is the spread around the instant it aims at. A press that
 * lands outside the window is a gag, as for a player. It finds the baby of a suspicious silence (story 1.21)
 * a reaction after the silence started, once per silence. In a lullaby walk (story 4.5) it plans one tap per
 * judged beat at `nextBeatAt + aimOffsetMs + jitterSdMs × N(0, 1)`, with **no reaction floor**: a rhythm is
 * anticipated, nobody reacts to a beat they can count; a plan whose beat is settled first is dropped.
 * A `wait` threat (story 4.6) is the opposite: it plans nothing before it sees the signal (state
 * `windowOpen`), then presses at `windowOpenAt + reaction + aimOffsetMs + jitterSdMs × N(0, 1)` (no ring on a
 * `wait`, so the mode does not matter).
 * **It never falls for the feint of a fake sleep (story 4.7)**: that is the same rule, a `wait` threat
 * is skipped until it is `windowOpen`, and the feint (`WaitFeintGiven`, `isFeintGiven`) is a beat of
 * the telegraph, not a signal. So the human bot says nothing of how hard the feint is for a player: its
 * numbers do not move with it, and only playing tells (open point 5 of story 4.7). On a Firmness judged
 * on its release (story 4.8) it presses a reaction after the telegraph and lets go at
 * `centre + the aim of a ring`: one draw, no signal needed, it aims at what is visible.
 * In a stealth step (story 4.9) it walks to the exit (and so creaks), parries a real wake like any
 * threat and never presses a false alarm: it holds its breath a reaction after the telegraph and
 * lets go at the end of the window `aimOffsetMs + jitterSdMs × N(0, 1)` away, one draw, so it sometimes gasps.
 * In the final rush (story 3.5) it tidies the props that are a mess, nearest first, from a reaction (drawn
 * once, when the door opens) after the door opened (`planTidy`): no aim draw.
 *
 * The order of the draws, which AC 6 of story 3.14 pins on the frozen settings: the attention (only when busy
 * and `missWhileBusyPct` is above 0), then the reaction (only when `reactionSdMs` is above 0), then the aim.
 */
export function createHumanBot(setup: BotSetup): Bot {
  const { reactionMeanMs, reactionSdMs, reactionMinMs, readError, aimOffsetMs, jitterSdMs } =
    setup.settings.human;
  const { missWhileBusyPct } = setup.settings.human;
  // What the player is shown decides how well it reads the time left on a ring.
  const ringError = setup.isChronoRingShown
    ? readError.withChronoRing
    : readError.withoutChronoRing;
  const rng = createRng(botSeed(setup.seed));
  const scheduler = createCommandScheduler();
  const cycles = createCycleMemory();
  const silences = createSilenceMemory();
  const firmHold = createFirmHold();
  const releaseDefIds = new Set(setup.releaseDefIds);
  // The cycles it has decided about (see `isMissed`), and the ones it decided not to answer.
  const attention = createCycleMemory();
  const missed = new Map<number, number>();
  // The false alarms whose breath is planned (story 4.9): a cycle of its own, since a `nothing` is never pressed.
  const breaths = createCycleMemory();
  // Where the walk to the exit last set off from: no new tap while Papa waits at the nearest point.
  const stealthWalk = createStealthWalkMemory();
  // The interlude the crib was last tapped in (story 4.10).
  const cycleDrop = createCycleDropMemory();
  // The prop tapped last in the final rush (story 3.5).
  const tidy = createTidyMemory();
  // The rush it has drawn its reaction for, and how long it waits (story 3.14: one draw per rush).
  let rush: { finalRushAt: number; waitMs: number } | null = null;
  // The tap that finds the baby, planned for one silence only: it is dropped if that silence ends first.
  let find: { startedAt: number; atMs: number } | null = null;
  // The tap planned for the beat in play: dropped if the beat is settled before it is sent.
  let beatTap: { beatAt: number; atMs: number } | null = null;
  let lastBeatAt: number | null = null;

  /** The reaction time of one response, in whole ms. One draw, none when its sd is 0. */
  const drawReactionMs = (): number => {
    const drawn =
      reactionSdMs === 0 ? reactionMeanMs : reactionMeanMs + reactionSdMs * nextGaussian(rng);
    return Math.round(Math.max(reactionMinMs, drawn));
  };
  /** Where it aims on a response, relative to the centre of the window: the ring's error, or the rhythm's. */
  const aimOf = (response: BotResponse, centreMs: number): number => {
    const { offsetMs, sdMs } = HAS_CHRONO_RING[response]
      ? ringError
      : { offsetMs: aimOffsetMs, sdMs: jitterSdMs };
    return centreMs + offsetMs + sdMs * nextGaussian(rng);
  };
  /** Busy elsewhere (D3): the bot's hands, or Papa's, are full. */
  const isBusy = (world: Readonly<World>, now: number): boolean =>
    firmHold.isHolding ||
    firmHold.tapUntil > now ||
    scheduler.size > 0 ||
    find !== null ||
    BUSY_PAPA_STATES.has(world.papa.state);
  /**
   * True when the bot never answers this cycle of `threat`. Decided once per cycle, the first time it sees it:
   * while it is free it always answers, while it is busy it misses with probability `missWhileBusyPct` %. A
   * decision is a draw only when it can matter (busy, and the percentage above 0). Remembered, so a threat
   * missed stays missed until it rearms.
   */
  const isMissed = (
    world: Readonly<World>,
    threat: Readonly<ThreatInstance>,
    now: number,
  ): boolean => {
    if (attention.isNew(threat) && missWhileBusyPct > 0 && isBusy(world, now)) {
      if (nextFloat(rng) * 100 < missWhileBusyPct) missed.set(threat.id, threat.windowOpenAt);
    }
    return missed.get(threat.id) === threat.windowOpenAt;
  };

  return {
    id: 'human',
    act(world: Readonly<World>, out: SimCommand[]) {
      const now = world.time.sim;
      const { beat } = world.sequence;
      if (beatTap !== null && beat.nextBeatAt !== beatTap.beatAt) beatTap = null;
      if (beat.isRunning && beat.nextBeatAt !== null && beat.nextBeatAt !== lastBeatAt) {
        lastBeatAt = beat.nextBeatAt;
        const aim = beat.nextBeatAt + aimOffsetMs + jitterSdMs * nextGaussian(rng);
        beatTap = { beatAt: beat.nextBeatAt, atMs: Math.max(Math.round(aim), now) };
      }
      if (beatTap !== null && beatTap.atMs < now + STEP_MS) {
        out.push({ type: 'TapBeat', t: asSimMs(beatTap.atMs) });
        beatTap = null;
      }
      const { startedAt } = world.silence;
      if (startedAt !== null && silences.isNew(world.silence)) {
        find = { startedAt, atMs: Math.max(startedAt + drawReactionMs(), now) };
      }
      if (find !== null) {
        if (startedAt !== find.startedAt) {
          find = null; // the silence ended (found, timed out, level over) before the bot got to it
        } else if (find.atMs < now + STEP_MS) {
          out.push({ type: 'TapBaby', t: asSimMs(find.atMs) });
          find = null;
        }
      }
      firmHold.update(world.threats, now, out);
      for (let i = 0; i < world.threats.length; i++) {
        const threat = world.threats[i] as Readonly<ThreatInstance>;
        if (!isPressable(threat)) continue;
        const response = responseOf(setup.responses, threat.defId);
        if (response === undefined) continue;
        // Seen for the first time in its cycle: busy or not, missed or not. It is decided even while a
        // Firmness is held (the answer waits for the finger, as before), so before the `continue` below.
        if (isMissed(world, threat, now)) continue;
        // One finger: while a Firmness is held, no other threat is pressed (it keeps its turn).
        if (firmHold.isHolding) continue;
        if (response === 'nothing') {
          // A false alarm (story 4.9): never pressed. It holds its breath a reaction after the telegraph
          // and lets go around the end of the window, `aimOffsetMs + jitterSdMs × N(0, 1)` away: one draw,
          // so it sometimes lets go too early and gasps.
          if (breaths.isNew(threat) && threat.responseWindow !== null) {
            const holdAt = Math.max(Math.round(threat.enteredAt + drawReactionMs()), now);
            const endAt = threat.windowOpenAt + threat.responseWindow.windowMs;
            const releaseAt = aimOf(response, endAt);
            scheduler.schedule({ type: 'HoldAnywhere', t: asSimMs(holdAt) });
            scheduler.schedule({
              type: 'ReleaseHold',
              t: asSimMs(Math.max(Math.round(releaseAt), holdAt + 1)),
            });
          }
          continue;
        }
        // A wait (story 4.6) cannot be planned from its telegraph: the signal is what the player
        // reacts to, and the instant the sim drew for it is not the player's to know. This `continue`
        // comes before `cycles.isNew`, or the telegraph would use up the cycle.
        if (response === 'wait' && threat.state !== 'windowOpen') continue;
        if (!cycles.isNew(threat)) continue;
        if (releaseDefIds.has(threat.defId)) {
          // The bomb drop (story 4.8): it aims at what is visible (the lowering), so it needs no signal.
          // It presses a reaction after the telegraph and lets go around the centre of the window, with
          // the error of a ring: one aim draw, like the other responses.
          const pressAt = Math.max(Math.round(threat.enteredAt + drawReactionMs()), now);
          const aim = aimOf(response, centreOf(threat));
          scheduleDrop(scheduler, firmHold, threat, pressAt, Math.round(aim));
          continue;
        }
        if (response === 'wait') {
          // A reaction to the signal, not an aim at the centre: the jitter is on the reaction, so
          // it can be late. One draw, like the other responses.
          const reactionAt = aimOf(response, threat.windowOpenAt + drawReactionMs());
          const pressAt = Math.max(Math.round(reactionAt), now);
          schedulePress(scheduler, firmHold, threat, response, pressAt, setup.settings.tapMs);
          continue;
        }
        const reactionMs = drawReactionMs();
        const aim = aimOf(response, centreOf(threat));
        const reacted = threat.enteredAt + reactionMs;
        // `now` is a floor too: a command never goes into the past.
        const pressAt = Math.max(Math.round(Math.max(reacted, aim)), now);
        schedulePress(scheduler, firmHold, threat, response, pressAt, setup.settings.tapMs);
      }
      scheduler.flush(now, out);
      planStealthWalk(world, setup.responses, out, stealthWalk);
      planCycleDrop(world, setup.responses, setup.safeSpot, out, cycleDrop);
      const { finalRushAt } = world.flow;
      if (finalRushAt !== null && rush?.finalRushAt !== finalRushAt) {
        rush = { finalRushAt, waitMs: drawReactionMs() };
      }
      planTidy(world, setup.responses, out, tidy, rush?.waitMs ?? reactionMeanMs);
    },
  };
}

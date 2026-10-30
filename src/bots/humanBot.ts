import { STEP_MS } from '@shared/constants';
import { createRng } from '@shared/rng';
import { asSimMs } from '@shared/time';
import type { SimCommand, ThreatInstance, World } from '@sim';
import type { Bot, BotSetup } from './bot.ts';
import { botSeed } from './botSeed.ts';
import { createCommandScheduler } from './commandScheduler.ts';
import { nextGaussian } from './gaussian.ts';
import {
  centreOf,
  createCycleMemory,
  createFirmHold,
  createSilenceMemory,
  isPressable,
  responseOf,
  schedulePress,
} from './threatTiming.ts';

/**
 * A plausible attentive player. When it first sees a telegraph it plans one press at
 * `max(telegraph + reactionMs, centre + aimOffsetMs + jitterSdMs × N(0, 1))`, in whole ms: the
 * reaction time is a floor (nobody presses before having seen the telegraph), the jitter is the
 * spread around the instant it aims at. A press that lands outside the window is a gag, as for a
 * player. It finds the baby of a suspicious silence (story 1.21) `reactionMs` after the silence
 * started, once per silence. In a lullaby walk (story 4.5) it plans one tap per judged beat at
 * `nextBeatAt + aimOffsetMs + jitterSdMs × N(0, 1)`, with **no `reactionMs` floor**: a rhythm is
 * anticipated, nobody reacts to a beat they can count; a plan whose beat is settled first is dropped.
 */
export function createHumanBot(setup: BotSetup): Bot {
  const { reactionMs, aimOffsetMs, jitterSdMs } = setup.settings.human;
  const rng = createRng(botSeed(setup.seed));
  const scheduler = createCommandScheduler();
  const cycles = createCycleMemory();
  const silences = createSilenceMemory();
  const firmHold = createFirmHold();
  // The tap that finds the baby, planned for one silence only: it is dropped if that silence ends first.
  let find: { startedAt: number; atMs: number } | null = null;
  // The tap planned for the beat in play: dropped if the beat is settled before it is sent.
  let beatTap: { beatAt: number; atMs: number } | null = null;
  let lastBeatAt: number | null = null;
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
        find = { startedAt, atMs: Math.max(startedAt + reactionMs, now) };
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
        // One finger: while a Firmness is held, no other threat is pressed (it keeps its turn).
        if (firmHold.isHolding) break;
        if (!isPressable(threat)) continue;
        const response = responseOf(setup.responses, threat.defId);
        if (response === undefined || !cycles.isNew(threat)) continue;
        const aim = centreOf(threat) + aimOffsetMs + jitterSdMs * nextGaussian(rng);
        const reacted = threat.enteredAt + reactionMs;
        // `now` is a floor too: a command never goes into the past.
        const pressAt = Math.max(Math.round(Math.max(reacted, aim)), now);
        schedulePress(scheduler, firmHold, threat, response, pressAt, setup.settings.tapMs);
      }
      scheduler.flush(now, out);
    },
  };
}

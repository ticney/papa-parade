import type { BotView } from '@bots/bot';
import { botViewOf } from '@bots/botView';
import { playGame } from '@bots/playGame';
import { STEP_MS } from '@shared/constants';
import { createSim, type SimCommand, type SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import {
  BOT_TEST_UNTIL_MS,
  botSetup,
  botTestLevel,
  legacyHuman,
  makeBot,
  responses,
} from '../support/botSupport.ts';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';

// The `human` bot with a follow view (story 9.8, AC 4): every `BotSetup` of the other bot tests has
// `view: null`, this is the one place the bot is driven with a frame to look through. The frozen room is
// nearly as wide as the frame, so a tight `feel.camera` puts the outlet (the far end of the room, Papa
// at the other) outside the frame.

const SEED = 3;
const NO_NOISE = { reactionMs: 0, aimOffsetMs: 0, jitterSdMs: 0 };

/** The frozen room seen by a follow camera whose frame is `frameWidthM` wide (the depth in proportion). */
async function play(options: {
  view: boolean;
  frameWidthM: number;
  bubbleReadMs: number;
  untilSimMs?: number;
}): Promise<{ events: SimEvent[]; commands: SimCommand[] }> {
  const content = createTestContent();
  content.feel.camera = {
    ...content.feel.camera,
    frameWidthM: options.frameWidthM,
    frameDepthM: options.frameWidthM * 0.7,
  };
  const level = botTestLevel();
  const geometry = createTestGeometry();
  const sim = await createSim({ content, geometry, level, seed: SEED, strictInvariants: true });
  const view: BotView | null = options.view
    ? botViewOf({
        camera: 'follow',
        geometry,
        threats: level.threats,
        babyBodyRadiusM: content.feel.baby.bodyRadiusM,
        screen: {
          widthPx: 844,
          heightPx: 390,
          hudBottomPx: 56,
          bubbleReadMs: options.bubbleReadMs,
        },
      })
    : null;
  const setup = { ...botSetup(SEED, { human: legacyHuman(NO_NOISE) }, level), view };
  const bot = makeBot('human', setup);
  const events: SimEvent[] = [];
  const commands: SimCommand[] = [];
  playGame(
    sim,
    {
      id: bot.id,
      act: (world, out) => {
        const before = out.length;
        bot.act(world, out);
        for (let i = before; i < out.length; i++) {
          const command = out[i] as SimCommand;
          expect(command.t).toBeGreaterThanOrEqual(world.time.sim);
          expect(command.t).toBeLessThan(world.time.sim + STEP_MS);
          commands.push(command);
        }
      },
    },
    options.untilSimMs ?? BOT_TEST_UNTIL_MS,
    (event) => events.push(event),
  );
  return { events, commands };
}

describe('the human bot with a follow view', () => {
  it('plays a threat that is in the frame as it always did, bubble reading or not', async () => {
    // A frame as wide as the room: the outlet is in it, so nothing is read and nothing is late.
    const wide = await play({ view: true, frameWidthM: 12, bubbleReadMs: 5000 });
    const fixed = await play({ view: false, frameWidthM: 12, bubbleReadMs: 5000 });
    const outlet = responses(wide.events);
    expect(outlet.length).toBeGreaterThanOrEqual(1);
    for (const response of outlet) expect(response.quality).toBe('perfect');
    expect(wide.commands).toEqual(fixed.commands);
  });

  it('reads the bubble of a threat outside the frame before it answers it', async () => {
    const quick = responses((await play({ view: true, frameWidthM: 3, bubbleReadMs: 0 })).events);
    expect(quick.length).toBeGreaterThanOrEqual(1);
    for (const response of quick) expect(response.quality).toBe('perfect');

    // A bubble read after the window has closed: the bot has not seen it in time, its press is late.
    const slow = responses((await play({ view: true, frameWidthM: 3, bubbleReadMs: 5000 })).events);
    // Only the first: once Papa has walked to the outlet, the next one is in the frame.
    expect(slow[0]?.quality).toBe('fail');
    expect(slow[0]?.reason).toBe('late');
  });

  it('never sends a press before the bubble is read', async () => {
    const readMs = 5000;
    const { events, commands } = await play({ view: true, frameWidthM: 3, bubbleReadMs: readMs });
    const telegraph = events.find((event) => event.type === 'ThreatTelegraphed');
    const press = commands.find((command) => command.type === 'PressThreat');
    if (telegraph === undefined || press === undefined) throw new Error('no threat answered');
    // The reaction floor is `seenAt + reaction`, and a bubble is seen a reading after the telegraph.
    expect(press.t).toBeGreaterThanOrEqual(telegraph.t + readMs);
  });
});

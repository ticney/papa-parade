import { fileURLToPath } from 'node:url';
import type { BotId } from '@bots/bot';
import { botResponsesOf, releaseDefIdsOf } from '@bots/botResponses';
import { createBot } from '@bots/createBot';
import { playGame } from '@bots/playGame';
import type { MamaMemory } from '@content/schemas/save';
import {
  addRunToMamaMemory,
  chooseMamaLines,
  createSim,
  type LevelEndReason,
  type MamaReactionLine,
  type MamaScore,
  mamaReactionsOf,
  mamaTagOf,
  type SimEvent,
} from '@sim';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSimLevel, type SimLevel } from '../../tools/sim/loadSimLevel.ts';
import { silenceCatastrophe } from '../support/noCatastrophe.ts';

// Story 3.8, FR36: « Maman se souvient », proved with no human. Two games of the real `createSim` on the
// live `salon_crawler`, played by bots, with the live `content/mama-lines.json`: the `idle` bot lets the
// stairs threat through, so `stairs_slide` is a tag of the game. The client's choice (`boot.ts` at
// `LevelScored`) is replayed here with the same pure functions of `@sim`: choose with the memory of the
// games before, then add the game to it.

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const CONTENT_DIR = `${REPO}content`;
const TIMEOUT_MS = 120_000;
const SEEDS = Array.from({ length: 20 }, (_, index) => index + 1);

let loaded: SimLevel;

beforeAll(async () => {
  const level = await loadSimLevel(CONTENT_DIR, 'salon_crawler');
  if (!level.ok) throw new Error(level.error);
  loaded = level.value;
  // This is about Mama's lines: an idle bot's gags would bring her home early and end the level (story 3.16 D14).
  silenceCatastrophe(loaded.content.feel);
}, TIMEOUT_MS);

interface PlayedGame {
  readonly seed: number;
  readonly endReason: LevelEndReason;
  readonly score: MamaScore;
  readonly tags: ReadonlySet<string>;
  /** How many events carried each tag: the tags are a set, the game may have slid more than once. */
  readonly occurrences: Readonly<Record<string, number>>;
}

/** One strict headless game: the end reason, Mama's note, and the tags `boot.ts` would collect. */
async function play(botId: BotId, seed: number): Promise<PlayedGame> {
  const { content, geometry, level } = loaded;
  const sim = await createSim({ content, geometry, level, seed, strictInvariants: true });
  try {
    const bot = createBot(botId, {
      seed,
      holdMinMs: content.feel.input.holdMinMs,
      responses: botResponsesOf(level.threats),
      releaseDefIds: releaseDefIdsOf(level.threats),
      choreObjectIds: [],
      isChronoRingShown: true,
      view: null,
      safeSpot: null,
      settings: content.bots,
    });
    if (!bot.ok) throw new Error(bot.error.message);
    const events: SimEvent[] = [];
    playGame(sim, bot.value, level.level.durationMs, (event) => events.push(event));
    const tags = new Set<string>();
    const occurrences: Record<string, number> = {};
    let endReason: LevelEndReason = 'timer';
    let score: MamaScore | null = null;
    for (const event of events) {
      const tag = mamaTagOf(event);
      if (tag !== null) {
        tags.add(tag);
        occurrences[tag] = (occurrences[tag] ?? 0) + 1;
      }
      if (event.type === 'LevelEnded') endReason = event.reason;
      if (event.type === 'LevelScored') {
        const { type: _type, t: _t, ...note } = event;
        score = note;
      }
    }
    if (score === null) throw new Error(`seed ${seed}: the level was never scored`);
    return { seed, endReason, score, tags, occurrences };
  } finally {
    sim.dispose();
  }
}

/** What `boot.ts` does at `LevelScored`: choose with the memory before the game, then record it. */
function chooseThenRecord(game: PlayedGame, memory: MamaMemory) {
  const lines = chooseMamaLines({
    reactions: mamaReactionsOf(game.score, game.endReason),
    endReason: game.endReason,
    runTags: game.tags,
    memory,
    lines: loaded.content.mamaLines.lines,
    seed: game.seed,
  });
  return { lines, memory: addRunToMamaMemory(memory, game.tags) };
}

const lineOf = (lines: readonly MamaReactionLine[], reaction: MamaReactionLine['reaction']) =>
  lines.find((line) => line.reaction === reaction);

describe('Mama remembers, on the live salon_crawler (story 3.8, FR36)', () => {
  it(
    'says « Pas si près de l’escalier ! » the first time the stairs slide, then « *Encore* l’escalier ?! »',
    async () => {
      // The first seed whose idle game ends on the timer with a stair slide and a Scream: say which in a failure.
      let first: PlayedGame | undefined;
      for (const seed of SEEDS) {
        const game = await play('idle', seed);
        if (
          game.endReason === 'timer' &&
          game.tags.has('stairs_slide') &&
          mamaReactionsOf(game.score, game.endReason).some((entry) => entry.reaction === 'scream')
        ) {
          first = game;
          break;
        }
      }
      if (first === undefined)
        throw new Error(`no seed of ${SEEDS.join(',')} slides on the stairs`);

      const one = chooseThenRecord(first, { counts: {} });
      expect(lineOf(one.lines, 'scream')?.lineId, `seed ${first.seed}`).toBe('stairs_first');
      expect(lineOf(one.lines, 'scream')?.text).toBe("Pas si près de l'escalier !");
      expect(one.memory.counts.stairs_slide).toBe(1);

      // The next game, with what the first one left: the same gag, a second time.
      const second = await play('idle', first.seed + 100);
      expect(second.tags.has('stairs_slide'), `seed ${second.seed}`).toBe(true);
      const two = chooseThenRecord(second, one.memory);
      const scream = lineOf(two.lines, 'scream');
      expect(scream?.lineId, `seed ${second.seed}`).toBe('stairs_again');
      expect(scream?.text).toBe("*Encore* l'escalier ?!");
      expect(two.memory.counts.stairs_slide).toBe(2);
    },
    TIMEOUT_MS,
  );

  it(
    'counts games, not occurrences: a game with many slides adds 1',
    async () => {
      // The first seed whose idle game has the stairs threat slide at least twice: the precondition that
      // makes « adds 1 » mean something (a per-occurrence counter would add 2 or more).
      let game: PlayedGame | undefined;
      for (const seed of SEEDS) {
        const candidate = await play('idle', seed);
        if ((candidate.occurrences.stairs_slide ?? 0) >= 2) {
          game = candidate;
          break;
        }
      }
      if (game === undefined)
        throw new Error(`no seed of ${SEEDS.join(',')} slides twice on the stairs`);
      expect(game.occurrences.stairs_slide, `seed ${game.seed}`).toBeGreaterThanOrEqual(2);
      expect(game.tags.has('stairs_slide')).toBe(true);
      expect(chooseThenRecord(game, { counts: {} }).memory.counts.stairs_slide).toBe(1);
      expect(
        chooseThenRecord(game, { counts: { stairs_slide: 4 } }).memory.counts.stairs_slide,
      ).toBe(5);
    },
    TIMEOUT_MS,
  );

  it(
    'does not say « encore » about a gag that did not happen in this game, however well she remembers it',
    async () => {
      const game = await play('perfect', 1);
      expect(game.tags.size).toBe(0);
      const { lines } = chooseThenRecord(game, { counts: { stairs_slide: 7, outlet_hair: 3 } });
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.text, line.lineId).not.toContain('*');
        expect(['laugh_any', 'sigh_any', 'scream_any']).toContain(line.lineId);
      }
    },
    TIMEOUT_MS,
  );

  it(
    'is reproducible: the same game and the same memory give the same lines',
    async () => {
      const game = await play('idle', 2);
      const memory: MamaMemory = { counts: { stairs_slide: 1 } };
      expect(chooseThenRecord(game, memory).lines).toEqual(chooseThenRecord(game, memory).lines);
      expect(chooseThenRecord(await play('idle', 2), memory).lines).toEqual(
        chooseThenRecord(game, memory).lines,
      );
    },
    TIMEOUT_MS,
  );
});

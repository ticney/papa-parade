import type { BotSettings } from './schemas/bots.ts';
import type { ChoreDef } from './schemas/chore.ts';
import type { DisruptionDef } from './schemas/disruption.ts';
import type { FeedbackTable } from './schemas/feedback.ts';
import type { Feel } from './schemas/feel.ts';
import type { Level } from './schemas/level.ts';
import type { MamaLines } from './schemas/mamaLines.ts';
import type { SequenceDef } from './schemas/sequence.ts';
import type { Strings } from './schemas/strings.ts';
import type { ThreatDef } from './schemas/threat.ts';

/** Everything the game reads from `content/`, validated. `createSim` receives it. */
export interface ContentBundle {
  feel: Feel;
  /** Client-only: the sim ignores it, so it never enters `feelHash` or a golden journal. */
  feedback: FeedbackTable;
  /** The sim ignores it too (outside every hash): only the bots and the autoplay read it. */
  bots: BotSettings;
  strings: Strings;
  /**
   * Story 3.8. Chosen from through `chooseMamaLines` (`@sim`) by the client, and carried by the bundle the
   * bots and the sim tools load. Outside the sim's hashes (`feelHash`, `levelHash`, the snapshot, the goldens):
   * choosing a line happens after `LevelScored` and draws nothing from the world. A journal's `contentHash`
   * covers the whole bundle, so editing a line moves it.
   */
  mamaLines: MamaLines;
}

/**
 * What one level plans, validated: the level file, exactly the threat defs it names and exactly the
 * disruption defs its waves plan and exactly the sequence defs it names, each keyed by id in order of first reference. `loadLevelContent`
 * builds it; `createSim` receives it.
 */
export interface LevelContent {
  level: Level;
  threats: Readonly<Record<string, ThreatDef>>;
  /** Story 1.20. Empty when no wave plans a disruption. */
  disruptions: Readonly<Record<string, DisruptionDef>>;
  /** Story 4.4. Empty when the level names no sequence. */
  sequences: Readonly<Record<string, SequenceDef>>;
  /**
   * Story 9.4. The chore def of each entry of `level.chores`, index-aligned. Present only when the
   * level declares stations, so that every other level keeps its `levelHash`.
   */
  chores?: readonly ChoreDef[];
}

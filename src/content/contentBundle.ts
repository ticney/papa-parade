import type { BotSettings } from './schemas/bots.ts';
import type { FeedbackTable } from './schemas/feedback.ts';
import type { Feel } from './schemas/feel.ts';
import type { Level } from './schemas/level.ts';
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
}

/**
 * What one level plans, validated: the level file and exactly the threat defs it names, keyed by
 * id in order of first reference. `loadLevelContent` builds it; `createSim` receives it.
 */
export interface LevelContent {
  level: Level;
  threats: Readonly<Record<string, ThreatDef>>;
}

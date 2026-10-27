import type { FeedbackTable } from './schemas/feedback.ts';
import type { Feel } from './schemas/feel.ts';
import type { Strings } from './schemas/strings.ts';

/** Everything the game reads from `content/`, validated. `createSim` receives it. */
export interface ContentBundle {
  feel: Feel;
  /** Client-only: the sim ignores it, so it never enters `feelHash` or a golden journal. */
  feedback: FeedbackTable;
  strings: Strings;
}

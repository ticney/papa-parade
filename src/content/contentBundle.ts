import type { Feel } from './schemas/feel.ts';
import type { Strings } from './schemas/strings.ts';

/** Everything the game reads from `content/`, validated. `createSim` receives it. */
export interface ContentBundle {
  feel: Feel;
  strings: Strings;
}

import type { BotResponse } from './bot.ts';

/**
 * The ids of the threat defs judged on a release (story 4.8), in order: a `firm` def with a `release`
 * key. Built beside {@link botResponsesOf}, which keeps its output: `BotResponse` stays the sim's, and a
 * release def is still `firm` there. Typed structurally like it (a bot may not import `@content`).
 */
export function releaseDefIdsOf(defs: Readonly<Record<string, object>>): string[] {
  return Object.entries(defs)
    .filter(([, def]) => 'release' in def && def.release !== undefined)
    .map(([defId]) => defId);
}

/**
 * What every threat def of a level asks for, by def id: the `responses` of a `BotSetup`. A bot is
 * only told about the defs it can answer. Typed structurally because a bot may not import
 * `@content`: a level's `threats` (def id → `ThreatDef`) fits. The CLI and the browser's autoplay
 * both call it, so the two bots cannot be told different things.
 */
export function botResponsesOf(
  defs: Readonly<Record<string, { readonly response: BotResponse }>>,
): Record<string, BotResponse> {
  const responses: Record<string, BotResponse> = {};
  for (const [defId, def] of Object.entries(defs)) responses[defId] = def.response;
  return responses;
}

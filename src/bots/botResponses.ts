import type { BotResponse } from './bot.ts';

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

import type { Sim, SimCommand, SimEvent } from '@sim';
import type { Bot } from './bot.ts';

/**
 * Plays `sim` with `bot` until the sim's time reaches `untilSimMs` or the level ends
 * (`world.flow.state === 'ended'`), whichever comes first: before each step the bot is
 * asked what it does, its commands are enqueued, then the step runs and its events are drained and
 * handed over one by one (the drained array is reused: copy what you keep). Allocation-free per
 * step apart from what the bot plans. The caller reads the result from `sim`.
 */
export function playGame(
  sim: Sim,
  bot: Bot,
  untilSimMs: number,
  onEvent?: (event: SimEvent) => void,
): void {
  const out: SimCommand[] = [];
  while (sim.world.time.sim < untilSimMs && sim.world.flow.state === 'playing') {
    out.length = 0;
    bot.act(sim.world, out);
    for (let i = 0; i < out.length; i++) sim.enqueue(out[i] as SimCommand);
    sim.step();
    const events = sim.drainEvents();
    if (onEvent !== undefined)
      for (let i = 0; i < events.length; i++) onEvent(events[i] as SimEvent);
  }
}

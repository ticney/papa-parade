import type { AudioBus, FeedbackTable } from '@content/schemas/feedback';
import { VOLUME_MAX_PCT } from '@shared/constants';
import type { AudioContextLike, GainNodeLike } from './webAudio.ts';

export interface BusGraph {
  /** One gain per bus, set from the table's `buses`: the mix. */
  readonly gains: Readonly<Record<AudioBus, GainNodeLike>>;
}

/** What the player multiplies each bus by, in whole percent (story 2.8): 100 leaves the mix as it is. */
export type PlayerVolumes = Readonly<Record<AudioBus, number>>;

/** The volumes of a player who has touched nothing. */
export const FULL_VOLUMES: PlayerVolumes = {
  music: VOLUME_MAX_PCT,
  sfx: VOLUME_MAX_PCT,
  voice: VOLUME_MAX_PCT,
  ui: VOLUME_MAX_PCT,
};

/** The linear gain of a bus: the table's `gainPct / 100` times the player's `pct / 100`. */
export function busGain(
  buses: FeedbackTable['buses'],
  bus: AudioBus,
  volumes: PlayerVolumes,
): number {
  return (buses[bus].gainPct / 100) * (volumes[bus] / 100);
}

/**
 * Four bus gains → one master gain → the destination. Gains are linear: `gainPct / 100` of the
 * table, times the player's volume (story 2.8).
 */
export function createBusGraph(
  context: AudioContextLike,
  buses: FeedbackTable['buses'],
  volumes: PlayerVolumes = FULL_VOLUMES,
): BusGraph {
  const master = context.createGain();
  master.connect(context.destination);
  const make = (bus: AudioBus): GainNodeLike => {
    const gain = context.createGain();
    gain.gain.value = busGain(buses, bus, volumes);
    gain.connect(master);
    return gain;
  };
  return {
    gains: { music: make('music'), sfx: make('sfx'), voice: make('voice'), ui: make('ui') },
  };
}

/** Sets the gain of each bus of an existing graph; nothing else moves. */
export function applyPlayerVolumes(
  graph: BusGraph,
  buses: FeedbackTable['buses'],
  volumes: PlayerVolumes,
): void {
  for (const bus of Object.keys(graph.gains) as AudioBus[]) {
    graph.gains[bus].gain.value = busGain(buses, bus, volumes);
  }
}

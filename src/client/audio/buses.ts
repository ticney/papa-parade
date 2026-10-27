import type { AudioBus, FeedbackTable } from '@content/schemas/feedback';
import type { AudioContextLike, GainNodeLike } from './webAudio.ts';

export interface BusGraph {
  /** One gain per bus, set from the table's `buses`: the mix. */
  readonly gains: Readonly<Record<AudioBus, GainNodeLike>>;
}

/** Four bus gains → one master gain → the destination. Gains are linear: `gainPct / 100`. */
export function createBusGraph(context: AudioContextLike, buses: FeedbackTable['buses']): BusGraph {
  const master = context.createGain();
  master.connect(context.destination);
  const make = (bus: AudioBus): GainNodeLike => {
    const gain = context.createGain();
    gain.gain.value = buses[bus].gainPct / 100;
    gain.connect(master);
    return gain;
  };
  return {
    gains: { music: make('music'), sfx: make('sfx'), voice: make('voice'), ui: make('ui') },
  };
}

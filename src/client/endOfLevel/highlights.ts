import type { ReplaySettings } from '@content/schemas/feedback';
import type { LevelEndReason, SimEvent } from '@sim';

/** The ways a moment of play scores (`feedback.json › replay › points`). */
export type HighlightKind = 'perfect' | 'messyGag' | 'nearMiss' | 'waveLast';

/**
 * One moment worth replaying (story 3.9, D3): **one threat at one sim time**, so the events one
 * threat emits in one step add up. `t` is sim ms. `anchorId` is the threat's anchor, from its
 * telegraph or hidden event, `null` for a threat the recorder never saw targeted.
 */
export interface Highlight {
  readonly t: number;
  readonly threatId: number;
  readonly points: number;
  readonly kinds: readonly HighlightKind[];
  readonly anchorId: string | null;
}

export interface HighlightRecorder {
  /** Feed it every sim event of the live game, in order. */
  onSimEvent(event: SimEvent): void;
  /** Forgets the game (a new level starts). */
  clear(): void;
  /**
   * The moments to replay, in chronological order (AC 5 to 7). Pure over what was recorded: the
   * same events always give the same moments.
   */
  pick(endReason: LevelEndReason, rules: ReplaySettings): readonly Highlight[];
}

interface ThreatFacts {
  readonly anchorId: string;
  readonly waveIndex: number;
}

interface Candidate {
  readonly t: number;
  readonly threatId: number;
  readonly kinds: Set<HighlightKind>;
}

/** The order the kinds are listed in a highlight: stable, whatever the events' order. */
const KIND_ORDER: readonly HighlightKind[] = ['perfect', 'messyGag', 'nearMiss', 'waveLast'];

export function createHighlightRecorder(): HighlightRecorder {
  let threats = new Map<number, ThreatFacts>();
  let responses: { t: number; threatId: number; quality: string }[] = [];
  let gags: { t: number; threatId: number }[] = [];
  let nearMisses: { t: number; threatId: number }[] = [];
  // Every prop hit or broken, with the props it names: `otherPropId` is a second prop of the mess.
  let propHits: { t: number; propIds: string[] }[] = [];

  function clear(): void {
    threats = new Map();
    responses = [];
    gags = [];
    nearMisses = [];
    propHits = [];
  }

  function onSimEvent(event: SimEvent): void {
    switch (event.type) {
      case 'ThreatTelegraphed':
      case 'ThreatHidden':
        threats.set(event.threatId, { anchorId: event.anchorId, waveIndex: event.waveIndex });
        return;
      case 'ResponseResolved':
        responses.push({ t: event.t, threatId: event.threatId, quality: event.quality });
        return;
      case 'GagTriggered':
        gags.push({ t: event.t, threatId: event.threatId });
        return;
      case 'NearMiss':
        nearMisses.push({ t: event.t, threatId: event.threatId });
        return;
      case 'PropImpact':
        propHits.push({
          t: event.t,
          propIds: event.otherPropId === null ? [event.propId] : [event.propId, event.otherPropId],
        });
        return;
      case 'PropBroken':
        propHits.push({ t: event.t, propIds: [event.propId] });
        return;
      // `NearMissFrozen` is the level's end, not a moment of play (its own doc): it scores nothing.
      default:
        return;
    }
  }

  /** Distinct props hit or broken within `messWindowMs` after the gag. */
  function messOf(gagT: number, windowMs: number): number {
    const props = new Set<string>();
    for (const hit of propHits) {
      if (hit.t < gagT || hit.t > gagT + windowMs) continue;
      for (const id of hit.propIds) props.add(id);
    }
    return props.size;
  }

  /** The `ResponseResolved` with the largest `t` of each wave (a later threat id wins a tie). */
  function waveLastOf(): readonly { t: number; threatId: number }[] {
    const lastOfWave = new Map<number, { t: number; threatId: number }>();
    for (const response of responses) {
      const wave = threats.get(response.threatId)?.waveIndex ?? -1;
      if (wave < 0) continue;
      const best = lastOfWave.get(wave);
      if (
        best === undefined ||
        response.t > best.t ||
        (response.t === best.t && response.threatId > best.threatId)
      ) {
        lastOfWave.set(wave, { t: response.t, threatId: response.threatId });
      }
    }
    return [...lastOfWave.values()];
  }

  function candidatesOf(endReason: LevelEndReason, rules: ReplaySettings): Candidate[] {
    const byKey = new Map<string, Candidate>();
    const candidate = (t: number, threatId: number): Candidate => {
      const key = `${threatId}@${t}`;
      let found = byKey.get(key);
      if (found === undefined) {
        found = { t, threatId, kinds: new Set() };
        byKey.set(key, found);
      }
      return found;
    };

    // The cascade of a lost level: only the gags are candidates (AC 7), with their own kinds.
    const isCascade = endReason === 'mamaHome';
    for (const gag of gags) {
      const found = candidate(gag.t, gag.threatId);
      if (messOf(gag.t, rules.messWindowMs) >= rules.messyGagMinProps) found.kinds.add('messyGag');
    }
    for (const miss of nearMisses) {
      // A near miss always follows its gag (same `t`); only a gag is a cascade candidate.
      if (isCascade && !byKey.has(`${miss.threatId}@${miss.t}`)) continue;
      candidate(miss.t, miss.threatId).kinds.add('nearMiss');
    }
    if (isCascade) return [...byKey.values()];

    for (const response of responses) {
      if (response.quality === 'perfect')
        candidate(response.t, response.threatId).kinds.add('perfect');
    }
    for (const last of waveLastOf()) candidate(last.t, last.threatId).kinds.add('waveLast');
    return [...byKey.values()];
  }

  function pick(endReason: LevelEndReason, rules: ReplaySettings): readonly Highlight[] {
    const isCascade = endReason === 'mamaHome';
    const scored = candidatesOf(endReason, rules).map((found): Highlight => {
      const kinds = KIND_ORDER.filter((kind) => found.kinds.has(kind));
      return {
        t: found.t,
        threatId: found.threatId,
        points: kinds.reduce((sum, kind) => sum + rules.points[kind], 0),
        kinds,
        anchorId: threats.get(found.threatId)?.anchorId ?? null,
      };
    });
    const pool = isCascade ? scored : scored.filter((highlight) => highlight.points > 0);
    // Cascade: the latest gag first. Otherwise: most points, then the later, then the lower id.
    pool.sort((a, b) =>
      isCascade
        ? b.t - a.t || a.threatId - b.threatId
        : b.points - a.points || b.t - a.t || a.threatId - b.threatId,
    );
    const taken: Highlight[] = [];
    for (const highlight of pool) {
      if (taken.length >= rules.momentCount) break;
      if (taken.every((other) => Math.abs(other.t - highlight.t) >= rules.minSpacingMs)) {
        taken.push(highlight);
      }
    }
    return taken.sort((a, b) => a.t - b.t || a.threatId - b.threatId);
  }

  return { onSimEvent, clear, pick };
}

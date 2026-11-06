import type { SimEvent } from '@sim';

/**
 * What the fairness check found in one run (story 3.13, FR75, ADR-011).
 */
export interface FairnessResult {
  /** Director-drawn windows that broke the rule, once each (see {@link createFairnessCheck}). */
  fairnessViolations: number;
  /** Director-drawn threats whose window opened later than their telegraph delay (the director waited). */
  stretchedTelegraphs: number;
  /** The sum of how much later, in ms, over those threats. */
  stretchSumMs: number;
}

/**
 * What the check reads of the held Firmnesses (story 9.7 review): a Firmness keeps Papa's finger down
 * after its window opens, so nothing else may open in its guard. Written plain, like the spacing.
 */
export interface HeldFirmnessSetup {
  /** `holdUntilMs` of each `firm` def that has one, by def id. */
  readonly holdUntilMsOf: Readonly<Record<string, number>>;
  /** `input.holdMinMs`. */
  readonly holdMinMs: number;
}

export interface FairnessCheck {
  onEvent(event: SimEvent): void;
  /** Call once the run is over. */
  finish(): FairnessResult;
}

/** One telegraph-to-rearm cycle of one threat, rebuilt from the events. */
interface Cycle {
  threatId: number;
  kind: string;
  /** The `ThreatHidden` came first: a suspicious silence (then found, if it was ever telegraphed). */
  isSilence: boolean;
  /** Event order of the `ThreatTelegraphed` (null while only hidden): « announced before » compares these. */
  telegraphedOrder: number | null;
  telegraphedAt: number | null;
  /** Director-drawn: telegraphed by a wave (`waveIndex ≥ 0`) with no `ThreatHidden` before it. */
  isDrawn: boolean;
  /** A silence was under way when this cycle was telegraphed. */
  isDrawnDuringSilence: boolean;
  /** Telegraphed by no wave (`waveIndex < 0`: the micro-sleep): Papa's need, checked against held Firmnesses only. */
  isNeed: boolean;
  openedAt: number | null;
  /** From `ResponseResolved.responseWindow`; null until resolved. */
  windowMs: number | null;
  toleranceMs: number | null;
}

/**
 * The fairness check: a black box over the events of a run and the level's effective feel, which
 * never calls the director's code (story 3.13 AC 10, D6). It rebuilds each threat cycle from
 * `ThreatHidden`, `ThreatTelegraphed`, `WindowOpened`, `ResponseResolved`, `SilenceEnded`,
 * `ThreatRearmed` and `ThreatCancelled`, keyed by threat id.
 *
 * A cycle B is *director-drawn* when its `ThreatTelegraphed` has `waveIndex ≥ 0` and no
 * `ThreatHidden` came before it in the cycle (a found silence is telegraphed by the baby system,
 * not drawn). `ForceThreat` carries the director's wave index, so a forced overlap is flagged too:
 * that is how a test proves the check can fail. A violation is counted once per B, at the end of
 * the run, when any of these holds, with A any other cycle (whatever spawned it) announced before
 * B's telegraph (same `t`: earlier in the event order) that has a `WindowOpened`:
 *  1. `|B.openedAt − A.openedAt| < spacingMs`;
 *  2. A is a found silence and `A.openedAt − spacingMs < B.openedAt < A.openedAt + A.windowMs +
 *     A.toleranceMs + spacingMs` (from A's `ResponseResolved.responseWindow`; a level that ends
 *     before A resolves leaves B unchecked against A's tail, which only the first clause covers);
 *  3. B's `ThreatTelegraphed` falls between a silence's `ThreatHidden` and its `SilenceEnded`.
 * The micro-sleep (and every threat no wave plans) is never B: it is Papa's need, not a draw. It
 * can still be A. `spacingMs` is read once, at creation (a run that `SetFeel`s the margin is out of scope).
 *
 * With `held` (story 9.7), a fourth clause covers a Firmness held on an anchor: its hold after the window
 * opens is `max(holdUntilMs, windowMs + toleranceMs + holdMinMs)` (`windowMs` from its `ResponseResolved`; a
 * Firmness never resolved holds `holdUntilMs`). With A a held Firmness announced before B, B is a violation when
 * `A.openedAt − spacingMs < B.openedAt < A.openedAt + hold + spacingMs`; with B a held Firmness and A any
 * other, when `A.openedAt − spacingMs − hold(B) < B.openedAt < A.openedAt + spacingMs`. The micro-sleep is
 * checked by the first form only (it keeps clear of a held Firmness and of nothing else).
 *
 * @param spacingMs the level's effective `movement.glideMaxMs + director.fairnessMarginMs`
 * @param telegraphDelayMsOf the telegraph delay by def id (`def.telegraphDelayMs ?? feel.timing.telegraphDelayDefaultMs`);
 *   a def missing from it (a `wait` def, whose signal adds a random delay) is left out of the stretch stats
 * @param held the held Firmnesses of the level; without it (or with no def in it) the fourth clause is off
 */
export function createFairnessCheck(
  spacingMs: number,
  telegraphDelayMsOf: Readonly<Record<string, number>>,
  held: HeldFirmnessSetup = { holdUntilMsOf: {}, holdMinMs: 0 },
): FairnessCheck {
  const cycles: Cycle[] = [];
  const openByThreat = new Map<number, Cycle>();
  const silencesUnderway = new Set<number>();
  let order = 0;

  /** How long the finger stays down after `cycle`'s window opened, in ms; 0 for any cycle that is not a held Firmness. */
  const holdOf = (cycle: Cycle): number => {
    const holdUntilMs = held.holdUntilMsOf[cycle.kind];
    if (holdUntilMs === undefined) return 0;
    if (cycle.windowMs === null || cycle.toleranceMs === null) return holdUntilMs;
    return Math.max(holdUntilMs, cycle.windowMs + cycle.toleranceMs + held.holdMinMs);
  };

  const startCycle = (threatId: number, kind: string, isSilence: boolean): Cycle => {
    const cycle: Cycle = {
      threatId,
      kind,
      isSilence,
      telegraphedOrder: null,
      telegraphedAt: null,
      isDrawn: false,
      isDrawnDuringSilence: false,
      isNeed: false,
      openedAt: null,
      windowMs: null,
      toleranceMs: null,
    };
    cycles.push(cycle);
    openByThreat.set(threatId, cycle);
    return cycle;
  };

  return {
    onEvent(event) {
      order++;
      if (event.type === 'ThreatHidden') {
        startCycle(event.threatId, event.kind, true);
        silencesUnderway.add(event.threatId);
      } else if (event.type === 'SilenceEnded') {
        silencesUnderway.delete(event.threatId);
      } else if (event.type === 'ThreatTelegraphed') {
        const hidden = openByThreat.get(event.threatId);
        const cycle =
          hidden?.isSilence === true && hidden.telegraphedOrder === null
            ? hidden
            : startCycle(event.threatId, event.kind, false);
        cycle.telegraphedOrder = order;
        cycle.telegraphedAt = event.t;
        if (!cycle.isSilence && event.waveIndex >= 0) {
          cycle.isDrawn = true;
          cycle.isDrawnDuringSilence = silencesUnderway.size > 0;
        } else if (!cycle.isSilence) {
          cycle.isNeed = true;
        }
      } else if (event.type === 'WindowOpened') {
        const cycle = openByThreat.get(event.threatId);
        if (cycle !== undefined) cycle.openedAt = event.t;
      } else if (event.type === 'ResponseResolved') {
        const cycle = openByThreat.get(event.threatId);
        if (cycle !== undefined) {
          cycle.windowMs = event.responseWindow.windowMs;
          cycle.toleranceMs = event.responseWindow.toleranceMs;
        }
      } else if (event.type === 'ThreatRearmed' || event.type === 'ThreatCancelled') {
        openByThreat.delete(event.threatId);
        silencesUnderway.delete(event.threatId);
      }
    },
    finish() {
      /**
       * Whether `b`, opening at `openedAt` and holding `ownHoldMs` after it, lands in the guard of a held
       * Firmness `a` announced before it (the fourth clause), or, if `b` is held itself, has `a` open in its hold.
       */
      const isInHeldGuard = (b: Cycle, openedAt: number, ownHoldMs: number): boolean => {
        if (b.telegraphedOrder === null) return false;
        for (const a of cycles) {
          if (a === b || a.telegraphedOrder === null || a.openedAt === null) continue;
          if (a.telegraphedOrder > b.telegraphedOrder) continue;
          const aHoldMs = holdOf(a);
          if (
            aHoldMs > 0 &&
            openedAt > a.openedAt - spacingMs &&
            openedAt < a.openedAt + aHoldMs + spacingMs
          ) {
            return true;
          }
          if (
            ownHoldMs > 0 &&
            openedAt > a.openedAt - spacingMs - ownHoldMs &&
            openedAt < a.openedAt + spacingMs
          ) {
            return true;
          }
        }
        return false;
      };
      let fairnessViolations = 0;
      let stretchedTelegraphs = 0;
      let stretchSumMs = 0;
      for (const b of cycles) {
        if (b.telegraphedOrder === null || b.telegraphedAt === null) continue;
        if (!b.isDrawn) {
          // The micro-sleep: only a held Firmness's guard binds it.
          if (b.isNeed && b.openedAt !== null && isInHeldGuard(b, b.openedAt, 0))
            fairnessViolations++;
          continue;
        }
        let isViolation = b.isDrawnDuringSilence;
        if (b.openedAt !== null) {
          const delayMs = telegraphDelayMsOf[b.kind];
          if (delayMs !== undefined) {
            const stretchMs = b.openedAt - b.telegraphedAt - delayMs;
            if (stretchMs > 0) {
              stretchedTelegraphs++;
              stretchSumMs += stretchMs;
            }
          }
          isViolation = isViolation || isInHeldGuard(b, b.openedAt, holdOf(b));
          for (const a of cycles) {
            if (isViolation) break;
            if (a === b || a.telegraphedOrder === null || a.openedAt === null) continue;
            if (a.telegraphedOrder > b.telegraphedOrder) continue;
            if (Math.abs(b.openedAt - a.openedAt) < spacingMs) isViolation = true;
            else if (
              a.isSilence &&
              a.windowMs !== null &&
              a.toleranceMs !== null &&
              b.openedAt > a.openedAt - spacingMs &&
              b.openedAt < a.openedAt + a.windowMs + a.toleranceMs + spacingMs
            ) {
              isViolation = true;
            }
          }
        }
        if (isViolation) fairnessViolations++;
      }
      return { fairnessViolations, stretchedTelegraphs, stretchSumMs };
    },
  };
}

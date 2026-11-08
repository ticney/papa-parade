// The pénombre of the outlet gag (story 3.15, UX-DR: icons, halos and rings stay fully readable). The sim owns
// the fact (`world.afterEffects.dimUntil`); this is only how the 3D lights follow it: they ease down to
// `fx.dim.lightsPct` over `fx.dim.fadeMs` and back, on the sim clock (a pause or a hitstop holds the fade).
// Pure of Three. The world UI is DOM over the canvas: lowering the lights cannot touch it, and nothing here
// may become a scrim, an overlay or a filter.

export interface DimFx {
  /**
   * The factor to scale the 3D lights by at `clockMs` (sim ms), 1 (full) down to `lightsPct / 100`. `isDim` is
   * the sim's fact; the factor moves towards it at the pace that crosses the whole range in `fadeMs` (0: at once).
   * Reads `lightsPct` and `fadeMs` each call, so a changed feel applies at once.
   */
  update(isDim: boolean, clockMs: number, lightsPct: number, fadeMs: number): number;
  /** Back to full light, forgetting the clock (a restart, a stopped loop). */
  reset(): void;
}

export function createDimFx(): DimFx {
  let factor = 1;
  let lastClockMs: number | null = null;
  return {
    update(isDim, clockMs, lightsPct, fadeMs) {
      const dtMs = lastClockMs === null ? 0 : Math.max(0, clockMs - lastClockMs);
      lastClockMs = clockMs;
      const dimmest = lightsPct / 100;
      const target = isDim ? dimmest : 1;
      if (!(fadeMs > 0)) {
        factor = target;
        return factor;
      }
      const stepSize = ((1 - dimmest) * dtMs) / fadeMs;
      if (factor > target) factor = Math.max(target, factor - stepSize);
      else if (factor < target) factor = Math.min(target, factor + stepSize);
      return factor;
    },
    reset() {
      factor = 1;
      lastClockMs = null;
    },
  };
}

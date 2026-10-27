/** The few fields of a `Gamepad` the left stick needs. */
export interface GamepadLike {
  readonly connected: boolean;
  readonly axes: ArrayLike<number>;
  /** `'standard'` for a pad with the standard layout (left stick on axes 0 and 1). */
  readonly mapping?: string;
}

/** Left-stick axes of the standard mapping: `x` to the right, `y` DOWN, each in `[-1, 1]`. */
export interface StickAxes {
  x: number;
  y: number;
}

export interface GamepadInput {
  /**
   * Reads the left stick of the first connected pad with the standard mapping into `out`, else of
   * the first connected pad that reports two axes; (0, 0) when there is none, so a pad that
   * disappears is simply "no direction". Meant to be called once per level frame.
   */
  poll(out: StickAxes): void;
}

/**
 * Gamepad API polling, with `getGamepads` injected (`navigator.getGamepads` in the browser): a
 * `Gamepad` is a snapshot in Chrome, so nothing is kept between two polls. There is no pause on a
 * disconnect and no button here (story 1.17).
 */
export function createGamepadInput(
  getGamepads: () => ArrayLike<GamepadLike | null | undefined>,
): GamepadInput {
  return {
    poll(out) {
      out.x = 0;
      out.y = 0;
      const pads = getGamepads();
      let fallback: GamepadLike | null = null;
      for (let i = 0; i < pads.length; i++) {
        const pad = pads[i];
        if (pad === null || pad === undefined || !pad.connected) continue;
        // A pad that reports no usable stick is not "the" pad: keep looking.
        if (typeof pad.axes[0] !== 'number' || typeof pad.axes[1] !== 'number') continue;
        if (pad.mapping === 'standard') {
          fallback = pad;
          break;
        }
        // A wheel or a motion sensor can sit before a real pad: only use it when nothing better exists.
        fallback ??= pad;
      }
      if (fallback === null) return;
      const x = fallback.axes[0] as number;
      const y = fallback.axes[1] as number;
      out.x = Number.isFinite(x) ? x : 0;
      out.y = Number.isFinite(y) ? y : 0;
    },
  };
}

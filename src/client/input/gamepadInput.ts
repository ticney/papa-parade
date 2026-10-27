/** The few fields of a `Gamepad` the left stick needs. */
export interface GamepadLike {
  readonly connected: boolean;
  readonly axes: ArrayLike<number>;
}

/** Left-stick axes of the standard mapping: `x` to the right, `y` DOWN, each in `[-1, 1]`. */
export interface StickAxes {
  x: number;
  y: number;
}

export interface GamepadInput {
  /**
   * Reads the left stick of the first connected pad into `out`; (0, 0) when there is none, so a
   * pad that disappears is simply "no direction". Meant to be called once per level frame.
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
      for (let i = 0; i < pads.length; i++) {
        const pad = pads[i];
        if (pad === null || pad === undefined || !pad.connected) continue;
        const x = pad.axes[0];
        const y = pad.axes[1];
        // A pad that reports no usable stick is not "the" pad: keep looking.
        if (typeof x !== 'number' || typeof y !== 'number') continue;
        out.x = Number.isFinite(x) ? x : 0;
        out.y = Number.isFinite(y) ? y : 0;
        return;
      }
    },
  };
}

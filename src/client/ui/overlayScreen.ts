/** One screen mounted in the overlay layer (`#pp-ui`). The overlay host shows at most one. */
export interface OverlayScreen {
  readonly element: HTMLElement;
  /** Receives focus when the screen appears. */
  readonly initialFocus: HTMLElement | null;
  /**
   * The screen's own action, for a gamepad's A or Start (story 1.17): the start screen starts the
   * game, the « Oups » screen presses « Réessayer ». `atReal` is the pad edge's own stamp, for
   * the screen that measures time (the calibration, story 2.7). Absent on a screen that has none.
   */
  activate?(atReal?: number): void;
  /**
   * B on a gamepad (story 2.7): the calibration skips its audio phase. Absent on a screen that has
   * no such action.
   */
  skip?(): void;
  /**
   * An arrow key inside the screen (story 2.8): moves focus, or changes the value of the focused
   * control. True when the key was the screen's, so that the shell cancels its default (a focused
   * range would otherwise move twice). Absent on a screen with nothing to move.
   */
  moveFocus?(code: string): boolean;
  /** B on a pad, Escape: back one level (story 2.8). Absent on a screen that has none. */
  back?(): void;
  /** Removes whatever the screen bound outside its own element (window listeners). */
  dispose(): void;
}

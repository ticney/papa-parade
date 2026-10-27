/** One screen mounted in the overlay layer (`#pp-ui`). The overlay host shows at most one. */
export interface OverlayScreen {
  readonly element: HTMLElement;
  /** Receives focus when the screen appears. */
  readonly initialFocus: HTMLElement | null;
  /**
   * The screen's own action, for a gamepad's A or Start (story 1.17): the start screen starts the
   * game, the « Oups » screen presses « Réessayer ». Absent on a screen that has none.
   */
  activate?(): void;
  /** Removes whatever the screen bound outside its own element (window listeners). */
  dispose(): void;
}

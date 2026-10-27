/** One screen mounted in the overlay layer (`#pp-ui`). The overlay host shows at most one. */
export interface OverlayScreen {
  readonly element: HTMLElement;
  /** Receives focus when the screen appears. */
  readonly initialFocus: HTMLElement | null;
  /** Removes whatever the screen bound outside its own element (window listeners). */
  dispose(): void;
}

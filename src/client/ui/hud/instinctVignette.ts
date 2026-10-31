type Doc = Pick<Document, 'createElement'>;

export interface InstinctVignette {
  /** The `instinct-vignette`, to put right before `#pp-world`. Transparent until the instinct is on. */
  readonly element: HTMLElement;
  /**
   * Once per frame: `isActive` is whether Fatherly Instinct is on (`world.instinct.state ===
   * 'active'` while the level plays and runs; false outside a level or under a pause). Writes the
   * DOM only when it changes, and allocates nothing.
   */
  update(isActive: boolean): void;
}

export const INSTINCT_VIGNETTE_CLASSES = {
  root: 'pp-instinct-vignette',
  on: 'pp-instinct-vignette-on',
} as const;

const CLASS_OFF: string = INSTINCT_VIGNETTE_CLASSES.root;
const CLASS_ON = `${INSTINCT_VIGNETTE_CLASSES.root} ${INSTINCT_VIGNETTE_CLASSES.on}`;

/**
 * The darkened edge of the screen while Fatherly Instinct lasts (story 2.9, UX-DR15 `instinct-vignette`):
 * a full-screen layer under the world's markers, a radial gradient of the `--pp-color-vignette` token
 * (never red). It follows state, not events, so a pause, a restart or the end of the level can never
 * leave it on. The fade is CSS (`ui.css`); it does not pulse, so there is nothing to clamp under the
 * 3 Hz rule nor to change for reduced motion. It takes no input and no focus.
 */
export function createInstinctVignette(doc: Doc): InstinctVignette {
  const element = doc.createElement('div');
  element.className = CLASS_OFF;
  element.setAttribute('aria-hidden', 'true');
  let isOn = false;
  return {
    element,
    update(isActive) {
      if (isActive === isOn) return;
      isOn = isActive;
      element.className = isActive ? CLASS_ON : CLASS_OFF;
    },
  };
}

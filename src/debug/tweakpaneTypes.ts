/**
 * The part of Tweakpane 4.0.5 the feel panel uses. The package's own typings import
 * `@tweakpane/core`, which it does not install (it is a build-time sibling there), so `Pane` loses
 * its methods under `tsc`; this is the subset we call, typed by hand. Nothing here is a runtime
 * value.
 */
export interface BindingLike {
  readonly element: HTMLElement;
  refresh(): void;
  on(event: 'change', handler: (event: { value: unknown; last: boolean }) => void): unknown;
}

export interface ButtonLike {
  disabled: boolean;
  on(event: 'click', handler: () => void): unknown;
}

export interface FolderLike {
  /** The folder's (or pane's) root element. */
  readonly element: HTMLElement;
  addFolder(params: { title: string; expanded?: boolean }): FolderLike;
  addBinding(target: object, key: string, params?: Record<string, unknown>): BindingLike;
  addButton(params: { title: string }): ButtonLike;
}

export interface PaneLike extends FolderLike {
  dispose(): void;
  refresh(): void;
}

export type PaneConstructor = new (config: { container: HTMLElement; title: string }) => PaneLike;

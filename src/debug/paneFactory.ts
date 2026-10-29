import { Pane as TweakpanePane } from 'tweakpane';
import type { PaneConstructor, PaneLike } from './tweakpaneTypes.ts';

const Pane = TweakpanePane as unknown as PaneConstructor;

export interface PaneFactory {
  create(container: HTMLElement, title: string): PaneLike;
  /** Takes the adopted stylesheet back out of the document. */
  dispose(): void;
}

/**
 * Makes the panes of one panel in `doc`. Tweakpane embeds its stylesheet as a `<style>` element
 * (each pane appends it again if the page has none), which the playtest's CSP
 * (`default-src 'self'`) refuses; the CSP is not widened for a debug tool. So the `<style>` the
 * library appends is caught before it is inserted, for every pane, and its text is applied through
 * the CSSOM (`adoptedStyleSheets`), which the CSP does not restrict: one sheet per factory (so per panel), kept
 * until `dispose`. Where that API is missing the library does what it always does.
 */
export function createPaneFactory(doc: Document): PaneFactory {
  const canAdopt = typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in doc;
  let sheet: CSSStyleSheet | null = null;
  return {
    create(container, title) {
      if (!canAdopt) return new Pane({ container, title });
      const head = doc.head;
      let css: string | null = null;
      const append = head.appendChild.bind(head);
      head.appendChild = (<T extends Node>(node: T): T => {
        if (node instanceof HTMLStyleElement && node.dataset.tpStyle !== undefined) {
          css = node.textContent;
          return node;
        }
        return append(node);
      }) as typeof head.appendChild;
      let pane: PaneLike;
      try {
        pane = new Pane({ container, title });
      } finally {
        // Our own property shadowed the prototype's method: dropping it gives the original back.
        delete (head as Partial<Node>).appendChild;
      }
      if (css !== null && sheet === null) {
        const adopted = new CSSStyleSheet();
        adopted.replaceSync(css);
        doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, adopted];
        sheet = adopted;
      }
      return pane;
    },
    dispose() {
      if (sheet === null) return;
      const adopted = sheet;
      sheet = null;
      doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((other) => other !== adopted);
    },
  };
}

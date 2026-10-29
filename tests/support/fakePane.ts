/**
 * A DOM node and a Tweakpane `Pane` reduced to what the feel panel uses, for unit tests (the Node
 * environment has neither). Story 2.1. A node keeps its children, class, text, `hidden`, `style`
 * and click listeners; it implements no layout. The pane records what was bound to it and lets a
 * test drive a control the way Tweakpane does: `emit` is a user edit, `refresh` re-emits the
 * target's value as a change (as the real `BindingApi.refresh` does).
 */

export class FakeNode {
  className = '';
  hidden = false;
  textContent = '';
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  children: FakeNode[] = [];
  parent: FakeNode | null = null;
  ownerDocument: FakeDocument | null = null;
  private readonly listeners = new Map<string, Array<() => void>>();
  readonly tag: string;

  constructor(tag: string, ownerDocument: FakeDocument | null = null) {
    this.tag = tag;
    this.ownerDocument = ownerDocument;
  }

  appendChild<T extends FakeNode>(node: T): T {
    node.remove();
    node.parent = this;
    this.children.push(node);
    return node;
  }

  append(...nodes: FakeNode[]): void {
    for (const node of nodes) this.appendChild(node);
  }

  prepend(...nodes: FakeNode[]): void {
    for (const node of [...nodes].reverse()) {
      node.remove();
      node.parent = this;
      this.children.unshift(node);
    }
  }

  after(node: FakeNode): void {
    const siblings = this.parent?.children;
    if (siblings === undefined || this.parent === null) return;
    node.remove();
    node.parent = this.parent;
    siblings.splice(siblings.indexOf(this) + 1, 0, node);
  }

  remove(): void {
    const siblings = this.parent?.children;
    if (siblings !== undefined) siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }

  replaceChildren(): void {
    for (const child of this.children) child.parent = null;
    this.children = [];
  }

  /** Only a `.class` selector. */
  querySelector(selector: string): FakeNode | null {
    return this.findAll(selector.slice(1))[0] ?? null;
  }

  findAll(className: string): FakeNode[] {
    const found: FakeNode[] = [];
    for (const child of this.children) {
      if (child.className.split(' ').includes(className)) found.push(child);
      found.push(...child.findAll(className));
    }
    return found;
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  /** Fires the listeners of `type`, as a tap would. */
  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

/** A `<style>`; a test stubs the global `HTMLStyleElement` with it. */
export class FakeStyleElement extends FakeNode {}

/** A `CSSStyleSheet`; a test stubs the global with it. */
export class FakeCssStyleSheet {
  css = '';
  replaceSync(css: string): void {
    this.css = css;
  }
}

export class FakeDocument {
  readonly head = new FakeNode('head', this);
  adoptedStyleSheets: FakeCssStyleSheet[] = [];
  createElement(tag: string): FakeNode {
    return tag === 'style' ? new FakeStyleElement(tag, this) : new FakeNode(tag, this);
  }
}

export interface FakeChange {
  value: unknown;
  last: boolean;
}

export class FakeBinding {
  readonly element: FakeNode;
  readonly label: FakeNode;
  readonly holder: Record<string, unknown>;
  readonly key: string;
  readonly params: Record<string, unknown>;
  private readonly handlers: Array<(event: FakeChange) => void> = [];

  constructor(
    doc: FakeDocument,
    holder: Record<string, unknown>,
    key: string,
    params: Record<string, unknown>,
  ) {
    this.holder = holder;
    this.key = key;
    this.params = params;
    this.element = new FakeNode('div', doc);
    this.element.className = 'tp-lblv';
    this.label = new FakeNode('div', doc);
    this.label.className = 'tp-lblv_l';
    this.label.textContent = String(params.label ?? key);
    this.element.append(this.label);
  }

  on(_event: 'change', handler: (event: FakeChange) => void): void {
    this.handlers.push(handler);
  }

  /** The user sets the control: the target takes the value and `change` fires. */
  emit(value: unknown, last = true): void {
    this.holder[this.key] = value;
    for (const handler of this.handlers) handler({ value, last });
  }

  /** Like Tweakpane's: shows the target's value again, which emits a final `change`. */
  refresh(): void {
    for (const handler of this.handlers) handler({ value: this.holder[this.key], last: true });
  }
}

export class FakeButton {
  disabled = false;
  readonly title: string;
  private readonly handlers: Array<() => void> = [];
  constructor(title: string) {
    this.title = title;
  }
  on(_event: 'click', handler: () => void): void {
    this.handlers.push(handler);
  }
  /** A tap; like a real button, a disabled one does nothing. */
  click(): void {
    if (this.disabled) return;
    for (const handler of this.handlers) handler();
  }
}

export class FakeFolder {
  readonly doc: FakeDocument;
  readonly title: string;
  readonly element: FakeNode;
  /** `.tp-fldv_c`: where the folder's blades go. */
  readonly content: FakeNode;
  readonly folders: FakeFolder[] = [];
  readonly bindings: FakeBinding[] = [];
  readonly buttons: FakeButton[] = [];

  constructor(doc: FakeDocument, title: string) {
    this.doc = doc;
    this.title = title;
    this.element = new FakeNode('div', doc);
    this.content = new FakeNode('div', doc);
    this.content.className = 'tp-fldv_c';
    this.element.append(this.content);
  }

  addFolder(params: { title: string }): FakeFolder {
    const folder = new FakeFolder(this.doc, params.title);
    this.content.append(folder.element);
    this.folders.push(folder);
    return folder;
  }

  addBinding(
    holder: Record<string, unknown>,
    key: string,
    params: Record<string, unknown> = {},
  ): FakeBinding {
    const binding = new FakeBinding(this.doc, holder, key, params);
    this.content.append(binding.element);
    this.bindings.push(binding);
    return binding;
  }

  addButton(params: { title: string }): FakeButton {
    const button = new FakeButton(params.title);
    this.buttons.push(button);
    return button;
  }

  /** Every binding of this folder and below. */
  allBindings(): FakeBinding[] {
    return [...this.bindings, ...this.folders.flatMap((folder) => folder.allBindings())];
  }

  allFolders(): FakeFolder[] {
    return this.folders.flatMap((folder) => [folder, ...folder.allFolders()]);
  }
}

/** What the next `new FakePane` does: a test sets `throwOnCreate` to see how the caller copes. */
export const fakePaneControl = { throwOnCreate: false };

export class FakePane extends FakeFolder {
  /** Every pane made, in order. */
  static instances: FakePane[] = [];
  isDisposed = false;

  constructor(config: { container: FakeNode; title: string }) {
    const doc = config.container.ownerDocument as FakeDocument;
    super(doc, config.title);
    if (fakePaneControl.throwOnCreate) {
      fakePaneControl.throwOnCreate = false;
      throw new Error('the fake pane was told to fail');
    }
    // Tweakpane adds its stylesheet to the page's head when the page has none yet.
    if (!doc.head.children.some((child) => child.dataset.tpStyle !== undefined)) {
      const style = doc.createElement('style');
      style.dataset.tpStyle = 'default';
      style.textContent = '.tp-fake { color: red; }';
      doc.head.appendChild(style);
    }
    config.container.append(this.element);
    FakePane.instances.push(this);
  }

  dispose(): void {
    this.isDisposed = true;
    this.element.remove();
  }

  refresh(): void {
    for (const binding of this.allBindings()) binding.refresh();
  }
}

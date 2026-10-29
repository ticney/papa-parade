/**
 * The little of the DOM the debug views touch, for unit tests: the Node environment has none. An
 * element keeps its children, `style`, `dataset`, `hidden` and text; it implements no layout and no
 * events. Story 2.1.
 */
export class FakeElement {
  className = '';
  hidden = false;
  textContent = '';
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  parent: FakeElement | null = null;

  readonly tag: string;

  constructor(tag: string) {
    this.tag = tag;
  }

  /** Typed like `ParentNode.append` so a fake can stand where a view wants a real parent. */
  append(...nodes: Node[]): void {
    for (const node of nodes as unknown as FakeElement[]) {
      node.parent = this;
      this.children.push(node);
    }
  }

  remove(): void {
    const siblings = this.parent?.children;
    if (siblings === undefined) return;
    siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }

  /** Every descendant (depth first) whose class list holds `className`. */
  findAll(className: string): FakeElement[] {
    const found: FakeElement[] = [];
    for (const child of this.children) {
      if (child.className.split(' ').includes(className)) found.push(child);
      found.push(...child.findAll(className));
    }
    return found;
  }
}

export const fakeDocument = {
  createElement: (tag: string): HTMLElement => new FakeElement(tag) as unknown as HTMLElement,
};

/** A parent the views can append to, with the document that makes their elements. */
export function createFakeRoot(): FakeElement & { ownerDocument: typeof fakeDocument } {
  const root = new FakeElement('div') as FakeElement & { ownerDocument: typeof fakeDocument };
  root.ownerDocument = fakeDocument;
  return root;
}

import { OrthographicCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { createWorldUi } from './worldUi.ts';

class FakeElement {
  ownerDocument = { defaultView: { Element: FakeElement } };
  className = '';
  style: Record<string, string> = {};
  parentNode: unknown = null;
  appended: FakeElement[] = [];
  setAttribute(): void {}
  append(): void {}
  appendChild(child: FakeElement): void {
    child.parentNode = this;
    this.appended.push(child);
  }
  animate() {
    return { cancel() {}, addEventListener() {} };
  }
}

function build() {
  const container = new FakeElement();
  const doc = { createElement: () => new FakeElement() } as unknown as Pick<
    Document,
    'createElement'
  >;
  const ui = createWorldUi(container as unknown as HTMLElement, doc);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.set(0, 5, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return { ui, container, camera };
}

describe('createWorldUi', () => {
  it('sizes its layer like the canvas', () => {
    const { ui, container } = build();
    ui.setSize(844, 390);
    expect(container.style.width).toBe('844px');
    expect(container.style.height).toBe('390px');
  });

  it('does not touch the DOM while nothing is visible', () => {
    const { ui, container, camera } = build();
    ui.setSize(844, 390);
    ui.render(camera);
    ui.render(camera);
    expect(Object.keys(container.style)).not.toContain('transform');
  });

  it('places the marker element when it is visible, and sorts nothing', () => {
    const { ui, camera, container } = build();
    ui.setSize(800, 400);
    ui.tapMarker.showAt(0, 0);
    const element = ui.scene.children[0] as unknown as { element: FakeElement };
    ui.render(camera);
    // The renderer wrote a transform: the marker sits at the centre of the layer (400, 200).
    expect(element.element.style.transform).toMatch(/translate\(400px, (200|199\.9\d*)px\)/);
    expect(element.element.parentNode).toBe(container);
  });
});

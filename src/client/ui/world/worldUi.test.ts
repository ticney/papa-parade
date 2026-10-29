import { OrthographicCamera } from 'three';
import { describe, expect, it } from 'vitest';
import type { VerbMetrics } from './verbMetrics.ts';
import { createWorldUi } from './worldUi.ts';

class FakeElement {
  ownerDocument = { defaultView: { Element: FakeElement } };
  className = '';
  vars = new Map<string, string>();
  style: Record<string, unknown> = {
    setProperty: (name: string, value: string) => {
      this.vars.set(name, value);
    },
    removeProperty: (name: string) => {
      this.vars.delete(name);
    },
  };
  classList = { toggle: () => false };
  parentNode: unknown = null;
  appended: FakeElement[] = [];
  hidden = false;
  setAttribute(): void {}
  removeAttribute(): void {}
  remove(): void {}
  append(): void {}
  appendChild(child: FakeElement): void {
    child.parentNode = this;
    this.appended.push(child);
  }
  animate() {
    return { cancel() {}, addEventListener() {} };
  }
}

function build(metrics?: VerbMetrics) {
  const container = new FakeElement();
  const doc = {
    createElement: () => new FakeElement(),
    createElementNS: () => new FakeElement(),
  } as unknown as Pick<Document, 'createElement' | 'createElementNS'>;
  const ui = createWorldUi(container as unknown as HTMLElement, doc, metrics);
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

  it('renders once an object icon is mounted, even with no tap marker or threat', () => {
    const { ui, camera } = build();
    ui.setSize(800, 400);
    ui.mountObjects([{ id: 'coffee_machine', kind: 'coffee_machine', xM: 0, yM: 0, zM: 0 }]);
    ui.render(camera);
    // The object icon is the last thing added to the layer's scene.
    const element = ui.scene.children.at(-1) as unknown as { element: FakeElement };
    expect(Object.keys(element.element.style)).toContain('transform');
    ui.unmountObjects();
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

describe('createWorldUi, threat icons', () => {
  const entry = {
    threatId: 1,
    xM: 0,
    yM: 0,
    zM: 0,
    icon: 'bolt' as const,
    followsPapa: false,
    verb: '',
    iconShape: 'circle' as const,
    color: 'parry' as const,
    verbWidthPx: 0,
    verbHeightPx: 0,
    verbOffsetPx: 0,
  };
  const threat = (state: string) =>
    [{ id: 1, state, windowOpenAt: 0, responseWindow: null }] as never;

  it('renders the layer while a threat icon shows, though no tap marker does', () => {
    const { ui, camera, container } = build();
    ui.setSize(800, 400);
    ui.mountThreats([entry]);
    expect(ui.threatEntries).toEqual([entry]);
    ui.updateThreats(threat('telegraph'), null, null);
    const object = ui.scene.children[2] as unknown as { element: FakeElement };
    ui.render(camera);
    expect(object.element.style.transform).toMatch(/translate\(400px, (200|199\.9\d*)px\)/);
    expect(object.element.parentNode).toBe(container);
  });

  it('stops rendering the layer once the icon is hidden', () => {
    const { ui, camera } = build();
    ui.setSize(800, 400);
    ui.mountThreats([entry]);
    ui.updateThreats(threat('telegraph'), null, null);
    ui.updateThreats(threat('resolved'), null, null);
    const object = ui.scene.children[2] as unknown as { element: FakeElement };
    object.element.style.transform = 'untouched';
    ui.render(camera);
    expect(object.element.style.transform).toBe('untouched');
  });

  it('forgets the icons on unmount', () => {
    const { ui } = build();
    ui.mountThreats([entry]);
    ui.unmountThreats();
    expect(ui.threatEntries).toEqual([]);
    expect(ui.scene.children).toHaveLength(2); // the tap marker and the glyph chip stay
  });
});

describe('createWorldUi, glyph chip (story 1.17)', () => {
  const entry = {
    threatId: 1,
    xM: 0,
    yM: 0,
    zM: 0,
    icon: 'bolt' as const,
    followsPapa: false,
    verb: '',
    iconShape: 'circle' as const,
    color: 'parry' as const,
    verbWidthPx: 0,
    verbHeightPx: 0,
    verbOffsetPx: 0,
  };

  it('renders the layer while the chip shows, and stops once it is hidden', () => {
    const { ui, camera, container } = build();
    ui.setSize(800, 400);
    ui.glyphChip.showAt(entry, 'Espace');
    const object = ui.scene.children[1] as unknown as { element: FakeElement };
    ui.render(camera);
    expect(object.element.style.transform).toMatch(/translate\(400px, (200|199\.9\d*)px\)/);
    expect(object.element.parentNode).toBe(container);
    ui.glyphChip.hide();
    object.element.style.transform = 'untouched';
    ui.render(camera);
    expect(object.element.style.transform).toBe('untouched');
  });

  it('passes the target and the press through updateThreats: only a press is reported', () => {
    const { ui } = build();
    ui.mountThreats([entry]);
    const threats = [{ id: 1, state: 'telegraph', windowOpenAt: 0, responseWindow: null }] as never;
    expect(ui.updateThreats(threats, null, 1)).toBe(false);
    expect(ui.updateThreats(threats, 1, 1)).toBe(true);
  });
});

describe('createWorldUi, verbs (story 2.2)', () => {
  /** Every character is half the font size wide. */
  const metrics: VerbMetrics = {
    surfaceKey: () => 'regular',
    basePx: () => 40,
    lineHeight: () => 1,
    scale: () => 1,
    widthPx: (text, fontPx) => text.length * fontPx * 0.5,
  };
  const base = {
    icon: 'bolt' as const,
    followsPapa: false,
    verb: 'RETIRE !',
    iconShape: 'circle' as const,
    color: 'parry' as const,
    verbWidthPx: 0,
    verbHeightPx: 0,
    verbOffsetPx: 0,
  };
  const closing = (id: number, closeAt: number) => ({
    id,
    state: 'telegraph',
    windowOpenAt: closeAt - 600,
    responseWindow: { windowMs: 600 },
  });

  it('lays the verbs out inside render, before the DOM renderer, from the camera', () => {
    const { ui, camera } = build(metrics);
    ui.setSize(800, 400);
    // The same point: the two verbs overlap whatever the camera.
    ui.mountThreats([
      { ...base, threatId: 1, xM: 0, yM: 0, zM: 0 },
      { ...base, threatId: 2, xM: 0, yM: 0, zM: 0 },
    ]);
    ui.updateThreats([closing(1, 5000), closing(2, 6000)] as never, null, null);
    expect(ui.threatEntries.map((e) => e.verbOffsetPx)).toEqual([0, 0]);
    ui.render(camera);
    expect(ui.threatEntries[0]?.verbOffsetPx).toBe(0);
    expect(ui.threatEntries[1]?.verbOffsetPx).toBeGreaterThan(0);
    // The renderer ran after the layout: both markers have their transform.
    const objects = ui.scene.children.slice(2, 4) as unknown as { element: FakeElement }[];
    for (const object of objects) expect(object.element.style.transform).toBeDefined();
  });

  it('moves the chip with the verb it hangs from, in the same render', () => {
    const { ui, camera } = build(metrics);
    ui.setSize(800, 400);
    ui.mountThreats([
      { ...base, threatId: 1, xM: 0, yM: 0, zM: 0 },
      { ...base, threatId: 2, xM: 0, yM: 0, zM: 0 },
    ]);
    ui.updateThreats([closing(1, 5000), closing(2, 6000)] as never, null, null);
    const lower = ui.threatEntries[1];
    if (lower === undefined) throw new Error('expected two entries');
    // `showAt` comes before `render` in the frame, so it sees the previous layout: no offset yet.
    ui.glyphChip.showAt(lower, 'Espace');
    // The scene holds the tap marker, then the chip (made first), then the markers mounted later.
    const chip = ui.scene.children[1] as unknown as { element: FakeElement };
    const riseBefore = chip.element.vars.get('--pp-chip-rise');
    ui.render(camera);
    expect(lower.verbOffsetPx).toBeGreaterThan(0);
    expect(chip.element.vars.get('--pp-chip-rise')).not.toBe(riseBefore);
    expect(Number.parseFloat(chip.element.vars.get('--pp-chip-rise') ?? '')).toBe(
      lower.verbOffsetPx + lower.verbHeightPx / 2,
    );
  });

  it('fits the verbs to the layer when it is sized, and again on refitVerbs', () => {
    const { ui } = build(metrics);
    ui.mountThreats([{ ...base, threatId: 1, xM: 0, yM: 0, zM: 0 }]);
    // Nothing to fit against yet.
    expect(ui.threatEntries[0]?.verbWidthPx).toBe(0);
    ui.setSize(800, 400);
    expect(ui.threatEntries[0]?.verbWidthPx).toBe(8 * 40 * 0.5 + 10);
    const entry = ui.threatEntries[0];
    if (entry === undefined) throw new Error('expected an entry');
    entry.verbWidthPx = 0;
    ui.refitVerbs();
    expect(entry.verbWidthPx).toBe(8 * 40 * 0.5 + 10);
  });
});

import type { StealthSlice } from '@sim';
import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { createStealthExitMarker, EXIT_DOOR_PATH } from './stealthExitMarker.ts';

class FakeElement {
  // What three's CSS2DObject reads when it is removed from a scene.
  ownerDocument = { defaultView: { Element: FakeElement } };
  parentNode: unknown = null;
  className = '';
  textContent = '';
  children: FakeElement[] = [];
  attributes = new Map<string, string>();
  style: Record<string, unknown> = { setProperty: () => {} };
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }
}

const slice = (patch: Partial<StealthSlice> = {}): StealthSlice => ({
  isRunning: true,
  exitXM: 2.9,
  exitZM: -2.8,
  nextAlertAt: null,
  breathLeftMs: 6000,
  breathHeldAt: null,
  isPassagePaid: false,
  creakZoneIndex: -1,
  ...patch,
});

function build() {
  const created: FakeElement[] = [];
  const make = () => {
    const element = new FakeElement();
    created.push(element);
    return element;
  };
  const doc = { createElement: make, createElementNS: make } as unknown as Pick<
    Document,
    'createElement' | 'createElementNS'
  >;
  const scene = new Scene();
  const marker = createStealthExitMarker(scene, doc, (key) => `<${key}>`);
  return { marker, scene, created, root: created[0] as FakeElement };
}

describe('the exit marker of a stealth step (story 4.9)', () => {
  it('says « SORS ! » through the translator and draws a door, aria-hidden', () => {
    const { created, root } = build();
    const verb = created.find((element) => element.className.includes('pp-exit-marker-verb'));
    expect(verb?.textContent).toBe('<verb.exit>');
    expect(root.attributes.get('aria-hidden')).toBe('true');
    const path = created.find((element) => element.attributes.get('d') === EXIT_DOOR_PATH);
    expect(path).toBeDefined();
  });

  it('is hidden until a stealth step runs, and shows at the exit', () => {
    const { marker, scene } = build();
    expect(marker.isVisible).toBe(false);
    marker.update(slice({ isRunning: false }));
    expect(marker.isVisible).toBe(false);
    marker.update(null);
    expect(marker.isVisible).toBe(false);
    marker.update(slice());
    expect(marker.isVisible).toBe(true);
    expect(scene.children[0]?.position.x).toBe(2.9);
    expect(scene.children[0]?.position.z).toBe(-2.8);
    expect(scene.children[0]?.position.y).toBeGreaterThan(0);
  });

  it('hides again when the step ends', () => {
    const { marker } = build();
    marker.update(slice());
    marker.update(slice({ isRunning: false, exitXM: 0, exitZM: 0 }));
    expect(marker.isVisible).toBe(false);
  });

  it('takes no pointer events: it is styled by a class that the CSS gives none', () => {
    const { root } = build();
    expect(root.className).toBe('pp-exit-marker');
  });

  it('removes itself on dispose', () => {
    const { marker, scene } = build();
    marker.update(slice());
    marker.dispose();
    expect(scene.children).toHaveLength(0);
    expect(marker.isVisible).toBe(false);
  });
});

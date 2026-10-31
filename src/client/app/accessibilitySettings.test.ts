import { createDefaultSettings, type Settings } from '@content/schemas/save';
import { LARGE_VERBS_SCALE } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { createAccessibilitySettings } from './accessibilitySettings.ts';

function build(initial: Partial<Settings> = {}, isOsReduced = false) {
  let settings: Settings = { ...createDefaultSettings(), ...initial };
  // A real `DOMStringMap` drops a key set to `undefined` only through `delete`: the fake keeps the
  // same contract, so a test that sees the key gone proves the attribute is removed.
  const dataset: Record<string, string> = {};
  const properties = new Map<string, string>();
  const listeners: Array<() => void> = [];
  const accesses: string[] = [];
  let osMatches = isOsReduced;
  const query = {
    get matches() {
      accesses.push('read');
      return osMatches;
    },
    set matches(next: boolean) {
      osMatches = next;
    },
    addEventListener: (_type: 'change', listener: () => void) => {
      accesses.push('listen');
      listeners.push(listener);
    },
  };
  let refitCount = 0;
  const accessibility = createAccessibilitySettings({
    root: {
      dataset: dataset as unknown as DOMStringMap,
      style: {
        setProperty: (name: string, value: string) => {
          properties.set(name, value);
        },
      } as unknown as CSSStyleDeclaration,
    },
    motionQuery: query as unknown as Pick<MediaQueryList, 'matches' | 'addEventListener'>,
    settings: () => settings,
    onVerbScaleChanged: () => {
      refitCount += 1;
    },
  });
  return {
    accessibility,
    dataset,
    properties,
    accesses,
    refits: () => refitCount,
    set: (next: Partial<Settings>) => {
      settings = { ...settings, ...next };
    },
    setOs: (matches: boolean) => {
      query.matches = matches;
    },
    fireChange: () => {
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.length,
  };
}

describe('isMotionReduced', () => {
  it.each([
    ['neither', false, false, false],
    ['the setting only', true, false, true],
    ['the OS only', false, true, true],
    ['both', true, true, true],
  ])('is %s → %s', (_name, setting, os, expected) => {
    const { accessibility } = build({ reducedMotion: setting }, os);
    expect(accessibility.isMotionReduced()).toBe(expected);
  });

  it('reads the setting live, at each call', () => {
    const t = build();
    expect(t.accessibility.isMotionReduced()).toBe(false);
    t.set({ reducedMotion: true });
    expect(t.accessibility.isMotionReduced()).toBe(true);
    t.set({ reducedMotion: false });
    expect(t.accessibility.isMotionReduced()).toBe(false);
  });

  it('follows the OS setting through the query’s change event', () => {
    const t = build();
    t.setOs(true);
    t.fireChange();
    expect(t.accessibility.isMotionReduced()).toBe(true);
    t.setOs(false);
    t.fireChange();
    expect(t.accessibility.isMotionReduced()).toBe(false);
  });
});

describe('isDeviceMotionReduced', () => {
  it('is the OS alone: the player’s switch does not change it', () => {
    expect(build({ reducedMotion: true }, false).accessibility.isDeviceMotionReduced()).toBe(false);
    expect(build({ reducedMotion: false }, true).accessibility.isDeviceMotionReduced()).toBe(true);
  });

  it('follows the OS setting through the query’s change event', () => {
    const t = build();
    t.setOs(true);
    t.fireChange();
    expect(t.accessibility.isDeviceMotionReduced()).toBe(true);
  });
});

describe('apply', () => {
  it('sets data-pp-motion to reduced when the setting is on, or the OS asks', () => {
    const setting = build({ reducedMotion: true });
    setting.accessibility.apply();
    expect(setting.dataset.ppMotion).toBe('reduced');
    const os = build({}, true);
    os.accessibility.apply();
    expect(os.dataset.ppMotion).toBe('reduced');
  });

  it('removes the attribute when neither asks any more', () => {
    const t = build({ reducedMotion: true });
    t.accessibility.apply();
    t.set({ reducedMotion: false });
    t.accessibility.apply();
    expect('ppMotion' in t.dataset).toBe(false);
  });

  it('writes --pp-verb-scale with setProperty: LARGE_VERBS_SCALE when on, 1 when off', () => {
    const t = build({ largeVerbs: true });
    t.accessibility.apply();
    expect(t.properties.get('--pp-verb-scale')).toBe(String(LARGE_VERBS_SCALE));
    t.set({ largeVerbs: false });
    t.accessibility.apply();
    expect(t.properties.get('--pp-verb-scale')).toBe('1');
  });

  it('calls onVerbScaleChanged once per real change of the scale, not per apply', () => {
    const t = build();
    // The page starts at 1 (`ui.css`): the first apply at 1 changes nothing.
    t.accessibility.apply();
    t.accessibility.apply();
    expect(t.refits()).toBe(0);
    t.set({ largeVerbs: true });
    t.accessibility.apply();
    t.accessibility.apply();
    expect(t.refits()).toBe(1);
    // A slider's SettingsChanged leaves the scale alone.
    t.set({ reducedMotion: true });
    t.accessibility.apply();
    expect(t.refits()).toBe(1);
    t.set({ largeVerbs: false });
    t.accessibility.apply();
    expect(t.refits()).toBe(2);
  });

  it('refits at the first apply when the saved scale is already large', () => {
    const t = build({ largeVerbs: true });
    t.accessibility.apply();
    expect(t.refits()).toBe(1);
  });
});

describe('the OS query', () => {
  it('re-applies on its change event, with the live value', () => {
    const t = build();
    t.accessibility.apply();
    expect('ppMotion' in t.dataset).toBe(false);
    t.setOs(true);
    t.fireChange();
    expect(t.dataset.ppMotion).toBe('reduced');
    t.setOs(false);
    t.fireChange();
    expect('ppMotion' in t.dataset).toBe(false);
  });

  it('listens once, at creation', () => {
    expect(build().listenerCount()).toBe(1);
  });

  it('reads the query once at creation, never per frame: Chromium drops the change of a list read in between', () => {
    const t = build();
    const readsAtCreation = t.accesses.filter((access) => access === 'read').length;
    expect(readsAtCreation).toBe(1);
    for (let frame = 0; frame < 100; frame++) t.accessibility.isMotionReduced();
    expect(t.accesses.filter((access) => access === 'read')).toHaveLength(readsAtCreation);
  });
});

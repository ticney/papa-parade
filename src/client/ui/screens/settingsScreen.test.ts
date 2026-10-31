import type { Settings } from '@content/schemas/save';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsScreen } from './settingsScreen.ts';

type Listener = (event: unknown) => void;

// The little of the DOM the settings screen and its press buttons use; the node environment has none.
class FakeElement {
  className = '';
  id = '';
  htmlFor = '';
  hidden = false;
  textContent = '';
  type = '';
  value = '';
  min = '';
  max = '';
  step = '';
  tabIndex = 0;
  isConnected = false;
  children: FakeElement[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, Set<Listener>>();
  properties = new Map<string, string>();
  scrolls: unknown[] = [];
  classNames = new Set<string>();
  classList = {
    add: (name: string) => this.classNames.add(name),
    remove: (name: string) => this.classNames.delete(name),
    toggle: () => undefined,
    contains: (name: string) => this.classNames.has(name),
  };
  style = { setProperty: (name: string, value: string) => this.properties.set(name, value) };
  readonly tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }
  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }
  focus(): void {
    fakeDocument.activeElement = this;
  }
  scrollIntoView(options: unknown): void {
    this.scrolls.push(options);
  }
  click(): void {
    // A keyboard or assistive-technology activation: `click` with `detail` 0.
    for (const listener of this.listeners.get('click') ?? []) listener({ detail: 0 });
  }
  /** The `input` event of a range after the user moved it. */
  input(value: number): void {
    this.value = String(value);
    for (const listener of this.listeners.get('input') ?? []) listener({});
  }
  get role(): string | undefined {
    return this.attributes.get('role');
  }
}

const fakeDocument: { activeElement: FakeElement | null; createElement(tag: string): FakeElement } =
  {
    activeElement: null,
    createElement: (tag) => new FakeElement(tag),
  };

const SAVED: Settings = {
  tier: 'normal',
  volumes: { music: 100, sfx: 100, voice: 100, ui: 100 },
  haptics: true,
  reducedMotion: false,
  largeVerbs: false,
};

function build(overrides: Partial<Settings> = {}, hasHaptics = true, isDeviceReduced = false) {
  const settings: Settings = {
    ...SAVED,
    ...overrides,
    volumes: { ...SAVED.volumes, ...overrides.volumes },
  };
  const changes: Settings[] = [];
  const settledAtChange: boolean[] = [];
  const calls: string[] = [];
  let panelOf = (): FakeElement => {
    throw new Error('the screen is not built yet');
  };
  const screen = createSettingsScreen({
    t: (key) => key,
    settings,
    hasHaptics,
    isDeviceMotionReduced: () => isDeviceReduced,
    onChange: (next) => {
      changes.push(next);
      settledAtChange.push(panelOf().classNames.has('pp-panel-settled'));
    },
    onRecalibrate: () => calls.push('recalibrate'),
    onCredits: () => calls.push('credits'),
    onBack: () => calls.push('back'),
  });
  const root = screen.element as unknown as FakeElement;
  const panel = root.children[0] as FakeElement;
  panelOf = () => panel;
  const [title, tierGroup, volumes] = panel.children as [FakeElement, FakeElement, FakeElement];
  const [tierLabel, segmented, hint, note] = tierGroup.children as [
    FakeElement,
    FakeElement,
    FakeElement,
    FakeElement,
  ];
  const radios = segmented.children;
  const sliderRows = volumes.children;
  const sliders = sliderRows.map((row) => row.children[2] as FakeElement);
  const switches = panel.children.filter((child) => child.role === 'switch');
  const toggle = hasHaptics ? (switches[0] as FakeElement) : null;
  const motionToggle = switches.at(-2) as FakeElement;
  const verbsToggle = switches.at(-1) as FakeElement;
  const actions = panel.children.at(-1) as FakeElement;
  const buttons = actions.children;
  return {
    screen,
    root,
    panel,
    title,
    tierLabel,
    segmented,
    hint,
    note,
    radios,
    sliderRows,
    sliders,
    toggle,
    motionToggle,
    verbsToggle,
    buttons,
    changes,
    settledAtChange,
    calls,
    settings,
  };
}

describe('createSettingsScreen (story 2.8)', () => {
  beforeEach(() => {
    fakeDocument.activeElement = null;
    vi.stubGlobal('document', fakeDocument);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('the layout', () => {
    it('is a modal dialog titled « Réglages » over the overlay', () => {
      const { root, panel, title } = build();
      expect(root.className).toContain('pp-overlay');
      expect(panel.role).toBe('dialog');
      expect(panel.attributes.get('aria-modal')).toBe('true');
      expect(panel.attributes.get('aria-label')).toBe('settings.title');
      expect(title.textContent).toBe('settings.title');
    });

    it('lists Difficulté, the four volumes, Vibrations, the two comfort switches, then Recalibrer, Crédits and Retour', () => {
      const { tierLabel, sliderRows, toggle, motionToggle, verbsToggle, panel, buttons } = build();
      expect(tierLabel.textContent).toBe('settings.difficulty');
      expect(sliderRows.map((row) => (row.children[0] as FakeElement).textContent)).toEqual([
        'settings.volume_music',
        'settings.volume_sfx',
        'settings.volume_voice',
        'settings.volume_ui',
      ]);
      expect(toggle?.role).toBe('switch');
      expect(panel.children.filter((child) => child.role === 'switch')).toEqual([
        toggle,
        motionToggle,
        verbsToggle,
      ]);
      const labelOf = (row: FakeElement | null) => row?.children[0]?.textContent;
      expect([toggle, motionToggle, verbsToggle].map(labelOf)).toEqual([
        'settings.haptics',
        'settings.reduced_motion',
        'settings.large_verbs',
      ]);
      expect(buttons.map((button) => button.textContent)).toEqual([
        'settings.recalibrate',
        'settings.credits',
        'settings.back',
      ]);
    });

    it('does not build the Vibrations row when the device cannot vibrate, but still builds the two others', () => {
      const { toggle, panel, motionToggle, verbsToggle, buttons } = build({}, false);
      expect(toggle).toBeNull();
      expect(panel.children.filter((child) => child.role === 'switch')).toEqual([
        motionToggle,
        verbsToggle,
      ]);
      expect(buttons).toHaveLength(3);
    });

    it('says, under « Réduire les animations », that the device already asks for it', () => {
      const b = build({}, true, true);
      const notes = b.panel.children.filter((child) => child.id === 'pp-settings-motion-device');
      expect(notes).toHaveLength(1);
      const [note] = notes as [FakeElement];
      expect(note.textContent).toBe('settings.reduced_motion_device');
      expect(b.panel.children.indexOf(note)).toBe(b.panel.children.indexOf(b.motionToggle) + 1);
      expect(b.motionToggle.attributes.get('aria-describedby')).toBe(note.id);
      // The saved switch is untouched: it still reads off, the note is what explains it.
      expect(b.motionToggle.attributes.get('aria-checked')).toBe('false');
    });

    it('builds no note when the device does not ask for reduced motion', () => {
      const b = build();
      expect(b.panel.children.some((child) => child.id === 'pp-settings-motion-device')).toBe(
        false,
      );
      expect(b.motionToggle.attributes.has('aria-describedby')).toBe(false);
    });
  });

  describe('Difficulté', () => {
    it('is a radio group of three radios, the saved one checked and the only tabbable one', () => {
      const { segmented, radios } = build({ tier: 'experienced' });
      expect(segmented.role).toBe('radiogroup');
      expect(radios.map((radio) => radio.role)).toEqual(['radio', 'radio', 'radio']);
      expect(radios.map((radio) => radio.textContent)).toEqual([
        'settings.tier_assistance',
        'settings.tier_normal',
        'settings.tier_experienced',
      ]);
      expect(radios.map((radio) => radio.attributes.get('aria-checked'))).toEqual([
        'false',
        'false',
        'true',
      ]);
      expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, -1, 0]);
    });

    it('takes focus on the selected radio, which is not always the first', () => {
      const { screen, radios } = build({ tier: 'experienced' });
      expect(screen.initialFocus).toBe(radios[2]);
      const normal = build();
      expect(normal.screen.initialFocus).toBe(normal.radios[1]);
    });

    it('shows the hint of the selected tier, then the « applied to the next game » note', () => {
      const { hint, note } = build({ tier: 'assistance' });
      expect(hint.textContent).toBe('settings.tier_assistance_hint');
      expect(note.textContent).toBe('settings.applies_next_game');
    });

    it('names the hint as the group’s description', () => {
      const { segmented, hint, tierLabel } = build();
      expect(segmented.attributes.get('aria-describedby')).toBe(hint.id);
      expect(segmented.attributes.get('aria-labelledby')).toBe(tierLabel.id);
    });

    it('selects a radio on a press: reports the whole settings, moves the check and the hint', () => {
      const { radios, hint, changes } = build();
      radios[0]?.click();
      expect(changes).toEqual([{ ...SAVED, tier: 'assistance' }]);
      expect(radios.map((radio) => radio.attributes.get('aria-checked'))).toEqual([
        'true',
        'false',
        'false',
      ]);
      expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);
      expect(hint.textContent).toBe('settings.tier_assistance_hint');
    });

    it('reports nothing when the selected radio is pressed again', () => {
      const { radios, changes } = build();
      radios[1]?.click();
      expect(changes).toEqual([]);
    });
  });

  describe('the volumes', () => {
    it('are ranges of 0 to 100 by steps of 5, labelled and set to the saved value', () => {
      const { sliders, sliderRows } = build({ volumes: { music: 40, sfx: 100, voice: 0, ui: 75 } });
      expect(sliders.map((slider) => slider.type)).toEqual(['range', 'range', 'range', 'range']);
      expect(sliders.map((slider) => [slider.min, slider.max, slider.step])).toEqual(
        Array(4).fill(['0', '100', '5']),
      );
      expect(sliders.map((slider) => slider.value)).toEqual(['40', '100', '0', '75']);
      for (const row of sliderRows) {
        const label = row.children[0] as FakeElement;
        expect(label.htmlFor).toBe((row.children[2] as FakeElement).id);
      }
    });

    it('draw their fill with a CSS variable, never an inline style attribute (the CSP forbids it)', () => {
      const { sliders, root } = build({ volumes: { music: 40, sfx: 100, voice: 0, ui: 75 } });
      expect(sliders.map((slider) => slider.properties.get('--pp-slider-fill'))).toEqual([
        '40%',
        '100%',
        '0%',
        '75%',
      ]);
      const everyElement = (element: FakeElement): FakeElement[] => [
        element,
        ...element.children.flatMap(everyElement),
      ];
      for (const element of everyElement(root)) expect(element.attributes.has('style')).toBe(false);
    });

    it('report the whole settings on every tick of the range, and move the fill', () => {
      const { sliders, changes } = build();
      sliders[0]?.input(60);
      sliders[0]?.input(55);
      expect(changes.map((change) => change.volumes.music)).toEqual([60, 55]);
      expect(changes[1]).toEqual({ ...SAVED, volumes: { ...SAVED.volumes, music: 55 } });
      expect(sliders[0]?.properties.get('--pp-slider-fill')).toBe('55%');
    });

    it('change one bus and leave the others', () => {
      const { sliders, changes } = build();
      sliders[2]?.input(0);
      expect(changes[0]?.volumes).toEqual({ music: 100, sfx: 100, voice: 0, ui: 100 });
    });

    it('clamp a value out of range', () => {
      const { sliders, changes } = build();
      sliders[1]?.input(140);
      sliders[1]?.input(-20);
      expect(changes.map((change) => change.volumes.sfx)).toEqual([0]);
    });
  });

  describe('Vibrations', () => {
    it('is a switch that shows the saved state', () => {
      expect(build({ haptics: true }).toggle?.attributes.get('aria-checked')).toBe('true');
      expect(build({ haptics: false }).toggle?.attributes.get('aria-checked')).toBe('false');
    });

    it('flips on a press and reports the whole settings', () => {
      const { toggle, changes } = build();
      toggle?.click();
      expect(toggle?.attributes.get('aria-checked')).toBe('false');
      toggle?.click();
      expect(toggle?.attributes.get('aria-checked')).toBe('true');
      expect(changes.map((change) => change.haptics)).toEqual([false, true]);
    });
  });

  describe('the two comfort switches (story 2.10)', () => {
    const SWITCHES = [
      ['Réduire les animations', 'motionToggle', 'reducedMotion'],
      ['Grands verbes', 'verbsToggle', 'largeVerbs'],
    ] as const;

    it.each(SWITCHES)('« %s » shows the saved state', (_name, which, field) => {
      expect(build({ [field]: true })[which].attributes.get('aria-checked')).toBe('true');
      expect(build({ [field]: false })[which].attributes.get('aria-checked')).toBe('false');
    });

    it.each(SWITCHES)(
      '« %s » flips on a press and reports the whole settings',
      (_name, which, field) => {
        const b = build();
        b[which].click();
        expect(b[which].attributes.get('aria-checked')).toBe('true');
        expect(b[which].className).toContain('pp-toggle-on');
        b[which].click();
        expect(b[which].attributes.get('aria-checked')).toBe('false');
        expect(b.changes.map((change) => change[field])).toEqual([true, false]);
        expect(b.changes[0]).toEqual({ ...SAVED, [field]: true });
      },
    );

    it('keep every other field when one flips: a slider tick must not reset a switch', () => {
      const b = build();
      b.motionToggle.click();
      b.verbsToggle.click();
      b.toggle?.click();
      b.sliders[0]?.input(60);
      b.radios[0]?.click();
      expect(b.changes.at(-1)).toEqual({
        tier: 'assistance',
        volumes: { ...SAVED.volumes, music: 60 },
        haptics: false,
        reducedMotion: true,
        largeVerbs: true,
      });
    });

    it('keep the two switches the player had when a screen is built over a saved state', () => {
      const b = build({ reducedMotion: true, largeVerbs: true });
      b.sliders[1]?.input(10);
      expect(b.changes.at(-1)).toMatchObject({ reducedMotion: true, largeVerbs: true });
    });

    it('settle the panel before they report, so that its animation does not restart under the finger', () => {
      const b = build();
      expect(b.panel.classNames.has('pp-panel-settled')).toBe(false);
      b.motionToggle.click();
      expect(b.panel.classNames.has('pp-panel-settled')).toBe(true);
      expect(b.settledAtChange).toEqual([true]);
      b.verbsToggle.click();
      expect(b.settledAtChange).toEqual([true, true]);
    });

    it('are pressed by A on a pad and by a tap, like Vibrations (kind: toggle)', () => {
      const b = build();
      b.motionToggle.focus();
      b.screen.activate?.();
      b.verbsToggle.focus();
      b.screen.activate?.();
      expect(b.changes.map((change) => [change.reducedMotion, change.largeVerbs])).toEqual([
        [true, false],
        [true, true],
      ]);
    });
  });

  describe('Recalibrer, Crédits and Retour', () => {
    it('call their own action', () => {
      const { buttons, calls } = build();
      for (const button of buttons) button.click();
      expect(calls).toEqual(['recalibrate', 'credits', 'back']);
    });
  });

  describe('moveFocus', () => {
    // Rows: tier, music, sfx, voice, ui, haptics, reduced motion, large verbs, recalibrate, credits, back.
    const rowsOf = (b: ReturnType<typeof build>): FakeElement[] => [
      b.radios[1] as FakeElement,
      ...b.sliders,
      b.toggle as FakeElement,
      b.motionToggle,
      b.verbsToggle,
      ...b.buttons,
    ];

    it('is true for the four arrows, so that the shell cancels their default, and false otherwise', () => {
      const { screen } = build();
      for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
        expect(screen.moveFocus?.(code), code).toBe(true);
      }
      for (const code of ['KeyA', 'Enter', 'Space', 'Tab']) {
        expect(screen.moveFocus?.(code), code).toBe(false);
      }
    });

    it('moves between the rows with Up and Down, wrapping, and scrolls the new one into view', () => {
      const b = build();
      const rows = rowsOf(b);
      b.radios[1]?.focus();
      for (let i = 1; i < rows.length; i++) {
        b.screen.moveFocus?.('ArrowDown');
        expect(fakeDocument.activeElement).toBe(rows[i]);
        expect(rows[i]?.scrolls.at(-1)).toEqual({ block: 'nearest' });
      }
      b.screen.moveFocus?.('ArrowDown');
      expect(fakeDocument.activeElement).toBe(rows[0]);
      b.screen.moveFocus?.('ArrowUp');
      expect(fakeDocument.activeElement).toBe(rows.at(-1));
    });

    it('treats the radio group as one row: Down from any radio leaves it', () => {
      const b = build({ tier: 'assistance' });
      b.radios[0]?.focus();
      b.screen.moveFocus?.('ArrowDown');
      expect(fakeDocument.activeElement).toBe(b.sliders[0]);
    });

    it('starts from the first row going down, and the last going up, when nothing has focus', () => {
      const b = build();
      b.screen.moveFocus?.('ArrowDown');
      expect(fakeDocument.activeElement).toBe(b.radios[1]);
      fakeDocument.activeElement = null;
      b.screen.moveFocus?.('ArrowUp');
      expect(fakeDocument.activeElement).toBe(b.buttons.at(-1));
    });

    it('selects the neighbour of the checked radio with Left and Right, and wraps', () => {
      const { screen, radios, changes } = build();
      radios[1]?.focus();
      screen.moveFocus?.('ArrowLeft');
      expect(changes.at(-1)?.tier).toBe('assistance');
      expect(fakeDocument.activeElement).toBe(radios[0]);
      screen.moveFocus?.('ArrowLeft');
      expect(changes.at(-1)?.tier).toBe('experienced');
      expect(fakeDocument.activeElement).toBe(radios[2]);
      screen.moveFocus?.('ArrowRight');
      expect(changes.at(-1)?.tier).toBe('assistance');
      expect(changes).toHaveLength(3);
    });

    it('moves a slider by one step with Left and Right, and clamps at both ends', () => {
      const b = build({ volumes: { music: 95, sfx: 5, voice: 100, ui: 100 } });
      b.sliders[0]?.focus();
      b.screen.moveFocus?.('ArrowRight');
      expect(b.sliders[0]?.value).toBe('100');
      b.screen.moveFocus?.('ArrowRight');
      expect(b.changes.map((change) => change.volumes.music)).toEqual([100]);
      b.sliders[1]?.focus();
      b.screen.moveFocus?.('ArrowLeft');
      b.screen.moveFocus?.('ArrowLeft');
      expect(b.sliders[1]?.value).toBe('0');
      // The first change is the music's (sfx still 5); the second the single step down to 0.
      expect(b.changes.map((change) => change.volumes.sfx)).toEqual([5, 0]);
    });

    it('moves a slider’s fill with it', () => {
      const b = build({ volumes: { music: 50, sfx: 100, voice: 100, ui: 100 } });
      b.sliders[0]?.focus();
      b.screen.moveFocus?.('ArrowLeft');
      expect(b.sliders[0]?.properties.get('--pp-slider-fill')).toBe('45%');
    });

    it('does nothing with Left and Right on the switch and the buttons, but still takes the key', () => {
      const b = build();
      for (const element of [
        b.toggle as FakeElement,
        b.motionToggle,
        b.verbsToggle,
        ...b.buttons,
      ]) {
        element.focus();
        expect(b.screen.moveFocus?.('ArrowLeft')).toBe(true);
        expect(b.screen.moveFocus?.('ArrowRight')).toBe(true);
      }
      expect(b.changes).toEqual([]);
      expect(b.calls).toEqual([]);
    });
  });

  describe('activate (A on a pad)', () => {
    it('presses the focused radio, switch or button', () => {
      const b = build();
      b.radios[2]?.focus();
      b.screen.activate?.();
      expect(b.changes.at(-1)?.tier).toBe('experienced');
      b.toggle?.focus();
      b.screen.activate?.();
      expect(b.changes.at(-1)?.haptics).toBe(false);
      b.buttons[1]?.focus();
      b.screen.activate?.();
      expect(b.calls).toEqual(['credits']);
    });

    it('does nothing with a range focused: its value moves with Left and Right', () => {
      const b = build();
      b.sliders[3]?.focus();
      b.screen.activate?.();
      expect(b.changes).toEqual([]);
    });

    it('brings focus back to the first row, and presses nothing, when focus was lost', () => {
      const b = build({ tier: 'assistance' });
      b.screen.activate?.();
      expect(fakeDocument.activeElement).toBe(b.radios[0]);
      expect(b.changes).toEqual([]);
      expect(b.calls).toEqual([]);
    });
  });

  describe('back', () => {
    it('goes back one level', () => {
      const { screen, calls } = build();
      screen.back?.();
      expect(calls).toEqual(['back']);
    });
  });

  describe('state', () => {
    it('keeps none of its own: a screen rebuilt from the saved values shows them', () => {
      const first = build();
      first.sliders[0]?.input(30);
      first.radios[0]?.click();
      first.toggle?.click();
      const saved = first.changes.at(-1) as Settings;
      const second = build(saved);
      expect(second.sliders[0]?.value).toBe('30');
      expect(second.radios[0]?.attributes.get('aria-checked')).toBe('true');
      expect(second.toggle?.attributes.get('aria-checked')).toBe('false');
    });

    it('never changes the settings object it was given (the save in memory)', () => {
      const b = build();
      const before = JSON.stringify(b.settings);
      b.sliders[0]?.input(10);
      b.radios[2]?.click();
      b.toggle?.click();
      expect(JSON.stringify(b.settings)).toBe(before);
    });

    it('hands out a fresh object at each change', () => {
      const b = build();
      b.sliders[0]?.input(10);
      b.sliders[0]?.input(20);
      expect(b.changes[0]).not.toBe(b.changes[1]);
      expect(b.changes[0]?.volumes.music).toBe(10);
    });

    it('unbinds its buttons on dispose', () => {
      const b = build();
      b.screen.dispose();
      b.buttons[0]?.click();
      b.radios[0]?.click();
      b.toggle?.click();
      expect(b.calls).toEqual([]);
      expect(b.changes).toEqual([]);
    });
  });
});

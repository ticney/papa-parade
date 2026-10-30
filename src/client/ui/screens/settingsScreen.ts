import type { Settings } from '@content/schemas/save';
import {
  DIFFICULTY_TIER_IDS,
  type DifficultyTierId,
  VOLUME_MAX_PCT,
  VOLUME_STEP_PCT,
} from '@shared/constants';
import { nextFocusIndex } from '../keys.ts';
import type { OverlayScreen } from '../overlayScreen.ts';
import { bindPressButton } from '../pressButton.ts';
import type { Translator } from '../strings.ts';

/** The four audio buses a player can turn down, in the order of the rows. */
const VOLUME_BUSES = ['music', 'sfx', 'voice', 'ui'] as const;
type VolumeBus = (typeof VOLUME_BUSES)[number];

// Literal keys, so that the string scanner sees every one the screen uses.
const TIER_KEYS: Readonly<Record<DifficultyTierId, { name: string; hint: string }>> = {
  assistance: { name: 'settings.tier_assistance', hint: 'settings.tier_assistance_hint' },
  normal: { name: 'settings.tier_normal', hint: 'settings.tier_normal_hint' },
  experienced: { name: 'settings.tier_experienced', hint: 'settings.tier_experienced_hint' },
};
const VOLUME_KEYS: Readonly<Record<VolumeBus, string>> = {
  music: 'settings.volume_music',
  sfx: 'settings.volume_sfx',
  voice: 'settings.volume_voice',
  ui: 'settings.volume_ui',
};

export interface SettingsScreenOptions {
  t: Translator;
  /** The saved settings: a screen holds no state of its own, a rebuilt one reads the save again. */
  settings: Settings;
  /** `false` when the device cannot vibrate: the « Vibrations » row is not built (EXPERIENCE.md). */
  hasHaptics: boolean;
  /** Called at once on every change (a slider calls it on each tick), with the whole settings. */
  onChange(settings: Settings): void;
  onRecalibrate(): void;
  onCredits(): void;
  onBack(): void;
}

/** One focusable row, for the vertical keys and the pad. */
interface Row {
  kind: 'tier' | 'slider' | 'toggle' | 'button';
  /** The bus of a `slider` row. */
  bus?: VolumeBus;
  /** Every element of the row that can hold focus. */
  elements: HTMLElement[];
  /** Where focus lands when the row is entered. */
  target(): HTMLElement;
}

/**
 * The settings (story 2.8; UX `settings-segmented`, `settings-slider`, `settings-toggle`). Every
 * change is applied and reported at once: there is no Save button. The tier applies to the next
 * game, which the note under it says. Up and Down move between rows, Left and Right change the
 * focused row (a radio selects its neighbour and wraps, a slider moves one step and clamps), A
 * presses the focused control and B goes back. The rows exceed a landscape phone, so the panel
 * scrolls: a move of focus scrolls the new row into view.
 */
export function createSettingsScreen(options: SettingsScreenOptions): OverlayScreen {
  const { t } = options;
  // Copied: the caller's object is the save in memory, which only `onChange` may replace.
  const current: Settings = {
    tier: options.settings.tier,
    volumes: { ...options.settings.volumes },
    haptics: options.settings.haptics,
  };
  const emit = (): void => {
    options.onChange({
      tier: current.tier,
      volumes: { ...current.volumes },
      haptics: current.haptics,
    });
  };

  const unbinds: Array<() => void> = [];
  const rows: Row[] = [];

  const element = document.createElement('div');
  element.className = 'pp-overlay pp-settings-screen';
  const panel = document.createElement('section');
  panel.className = 'pp-panel pp-settings-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', t('settings.title'));
  const title = document.createElement('h2');
  title.className = 'pp-panel-title pp-type-heading';
  title.textContent = t('settings.title');
  panel.append(title);

  // --- Difficulty: a radio group, then the hint of the selected tier and the note -------------------
  const tierGroup = document.createElement('div');
  tierGroup.className = 'pp-settings-group';
  const tierLabel = document.createElement('p');
  tierLabel.className = 'pp-settings-label';
  tierLabel.id = 'pp-settings-tier-label';
  tierLabel.textContent = t('settings.difficulty');
  const segmented = document.createElement('div');
  segmented.className = 'pp-segmented';
  segmented.setAttribute('role', 'radiogroup');
  segmented.setAttribute('aria-labelledby', tierLabel.id);
  const hint = document.createElement('p');
  hint.className = 'pp-settings-hint';
  hint.id = 'pp-settings-tier-hint';
  segmented.setAttribute('aria-describedby', hint.id);
  const note = document.createElement('p');
  note.className = 'pp-settings-note';
  note.textContent = t('settings.applies_next_game');

  const radios = new Map<DifficultyTierId, HTMLButtonElement>();

  /** Shows `tier` as the selected radio; true when it changed. Roving tabindex: only it is tabbable. */
  const showTier = (tier: DifficultyTierId): void => {
    for (const [id, radio] of radios) {
      const isSelected = id === tier;
      radio.setAttribute('aria-checked', isSelected ? 'true' : 'false');
      radio.tabIndex = isSelected ? 0 : -1;
      radio.className = isSelected ? 'pp-segment pp-segment-selected' : 'pp-segment';
    }
    hint.textContent = t(TIER_KEYS[tier].hint);
  };
  const selectTier = (tier: DifficultyTierId, shouldFocus: boolean): void => {
    const radio = radios.get(tier);
    if (shouldFocus) radio?.focus({ preventScroll: true });
    if (tier === current.tier) return;
    current.tier = tier;
    showTier(tier);
    emit();
  };

  for (const tier of DIFFICULTY_TIER_IDS) {
    const radio = document.createElement('button');
    radio.type = 'button';
    radio.setAttribute('role', 'radio');
    radio.textContent = t(TIER_KEYS[tier].name);
    radios.set(tier, radio);
    unbinds.push(bindPressButton(radio, () => selectTier(tier, true)));
    segmented.append(radio);
  }
  showTier(current.tier);
  tierGroup.append(tierLabel, segmented, hint, note);
  panel.append(tierGroup);
  rows.push({
    kind: 'tier',
    elements: [...radios.values()],
    target: () => radios.get(current.tier) as HTMLElement,
  });

  // --- Volumes: one slider per bus ---------------------------------------------------------------------
  const volumes = document.createElement('div');
  volumes.className = 'pp-settings-volumes';
  const sliders = new Map<VolumeBus, HTMLInputElement>();
  const readouts = new Map<VolumeBus, HTMLElement>();
  /** A CSS variable, never an inline `style` attribute: the CSP forbids it. */
  const showVolume = (bus: VolumeBus, value: number): void => {
    const slider = sliders.get(bus);
    slider?.style.setProperty('--pp-slider-fill', `${value}%`);
    const readout = readouts.get(bus);
    if (readout !== undefined) readout.textContent = String(value);
  };
  const setVolume = (bus: VolumeBus, value: number): void => {
    const clamped = Math.min(VOLUME_MAX_PCT, Math.max(0, Math.round(value)));
    const slider = sliders.get(bus);
    if (slider !== undefined) slider.value = String(clamped);
    showVolume(bus, clamped);
    if (clamped === current.volumes[bus]) return;
    current.volumes[bus] = clamped;
    emit();
  };

  for (const bus of VOLUME_BUSES) {
    const row = document.createElement('div');
    row.className = 'pp-slider-row';
    const id = `pp-settings-volume-${bus}`;
    const label = document.createElement('label');
    label.className = 'pp-slider-label';
    label.htmlFor = id;
    label.textContent = t(VOLUME_KEYS[bus]);
    const readout = document.createElement('span');
    readout.className = 'pp-slider-value';
    readout.setAttribute('aria-hidden', 'true');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'pp-slider';
    slider.id = id;
    slider.min = '0';
    slider.max = String(VOLUME_MAX_PCT);
    slider.step = String(VOLUME_STEP_PCT);
    slider.value = String(current.volumes[bus]);
    sliders.set(bus, slider);
    readouts.set(bus, readout);
    showVolume(bus, current.volumes[bus]);
    slider.addEventListener('input', () => setVolume(bus, Number(slider.value)));
    row.append(label, readout, slider);
    volumes.append(row);
    rows.push({ kind: 'slider', bus, elements: [slider], target: () => slider });
  }
  panel.append(volumes);

  // --- Vibrations: a switch, not built when the device cannot vibrate -------------------------------------
  if (options.hasHaptics) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pp-toggle';
    button.setAttribute('role', 'switch');
    const text = document.createElement('span');
    text.className = 'pp-toggle-label';
    text.textContent = t('settings.haptics');
    const track = document.createElement('span');
    track.className = 'pp-toggle-track';
    track.setAttribute('aria-hidden', 'true');
    const thumb = document.createElement('span');
    thumb.className = 'pp-toggle-thumb';
    track.append(thumb);
    button.append(text, track);
    const showHaptics = (): void => {
      button.setAttribute('aria-checked', current.haptics ? 'true' : 'false');
      button.className = current.haptics ? 'pp-toggle pp-toggle-on' : 'pp-toggle';
    };
    showHaptics();
    unbinds.push(
      bindPressButton(button, () => {
        current.haptics = !current.haptics;
        showHaptics();
        emit();
      }),
    );
    panel.append(button);
    rows.push({ kind: 'toggle', elements: [button], target: () => button });
  }

  // --- Recalibrer, Crédits, Retour ------------------------------------------------------------------------
  const actions = document.createElement('div');
  actions.className = 'pp-panel-actions';
  const buttonRow = (labelKey: string, variant: 'secondary' | 'tertiary', onPress: () => void) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `pp-button pp-button-${variant}`;
    button.textContent = t(labelKey);
    button.setAttribute('aria-label', t(labelKey));
    unbinds.push(bindPressButton(button, onPress));
    actions.append(button);
    rows.push({ kind: 'button', elements: [button], target: () => button });
  };
  buttonRow('settings.recalibrate', 'secondary', options.onRecalibrate);
  buttonRow('settings.credits', 'secondary', options.onCredits);
  buttonRow('settings.back', 'tertiary', options.onBack);
  panel.append(actions);
  element.append(panel);

  const rowOf = (focused: Element | null): number =>
    rows.findIndex((row) => row.elements.some((candidate) => candidate === focused));

  const focusRow = (index: number): void => {
    const target = rows[index]?.target();
    if (target === undefined) return;
    target.focus({ preventScroll: true });
    // `preventScroll` alone would leave « Crédits » hidden below the fold of a phone.
    target.scrollIntoView({ block: 'nearest' });
  };

  return {
    element,
    initialFocus: radios.get(current.tier) ?? null,
    moveFocus(code) {
      if (code === 'ArrowUp' || code === 'ArrowDown') {
        const at = rowOf(document.activeElement);
        const target = nextFocusIndex(rows.length, at, code);
        if (target !== null) focusRow(target);
        return true;
      }
      if (code !== 'ArrowLeft' && code !== 'ArrowRight') return false;
      const step = code === 'ArrowRight' ? 1 : -1;
      const at = rowOf(document.activeElement);
      const row = rows[at];
      if (row === undefined) return true;
      if (row.kind === 'tier') {
        const index = DIFFICULTY_TIER_IDS.indexOf(current.tier);
        const next = DIFFICULTY_TIER_IDS[
          (index + step + DIFFICULTY_TIER_IDS.length) % DIFFICULTY_TIER_IDS.length
        ] as DifficultyTierId;
        selectTier(next, true);
        radios.get(next)?.scrollIntoView({ block: 'nearest' });
      } else if (row.kind === 'slider' && row.bus !== undefined) {
        setVolume(row.bus, current.volumes[row.bus] + step * VOLUME_STEP_PCT);
      }
      return true;
    },
    activate() {
      const focused = document.activeElement;
      const at = rowOf(focused);
      if (at < 0) {
        // Focus was lost (a press outside any control): bring it back, press nothing.
        focusRow(0);
        return;
      }
      // A range has no press: its value is moved by Left and Right.
      if (rows[at]?.kind === 'slider') return;
      (focused as HTMLElement).click();
    },
    back() {
      options.onBack();
    },
    dispose() {
      for (const unbind of unbinds) unbind();
    },
  };
}

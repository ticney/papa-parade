import type { Translator } from '../strings.ts';
import { createPauseButton } from './pauseButton.ts';

export interface HudLayer {
  /** Shown in a level only. */
  setVisible(isVisible: boolean): void;
  /** Off while paused, counting down, or covered: nothing in the HUD takes focus or taps then. */
  setInteractive(isInteractive: boolean): void;
}

export interface HudLayerOptions {
  t: Translator;
  onPausePress(): void;
  /** The `hud-gauge` pill (story 1.19), top-left: hidden while the level has no gauge. */
  gauges: HTMLElement;
  /** The `hud-timer` pill (story 1.18), top-centre. */
  timer: HTMLElement;
}

const ZONES = ['gauges', 'timer', 'pause'] as const;

/**
 * Builds the HUD into `root` (`#pp-hud`): one row with three fixed zones, gauges top-left (story
 * 1.19), timer top-centre (story 1.18), pause top-right. The bottom third is never used.
 */
export function createHudLayer(root: HTMLElement, options: HudLayerOptions): HudLayer {
  const row = document.createElement('div');
  row.className = 'pp-hud-row';
  const zones = new Map<(typeof ZONES)[number], HTMLElement>();
  for (const name of ZONES) {
    const zone = document.createElement('div');
    zone.className = 'pp-hud-zone';
    zone.dataset.ppZone = name;
    zones.set(name, zone);
    row.append(zone);
  }
  const pauseButton = createPauseButton({ t: options.t, onPress: options.onPausePress });
  (zones.get('pause') as HTMLElement).append(pauseButton.element);
  (zones.get('gauges') as HTMLElement).append(options.gauges);
  (zones.get('timer') as HTMLElement).append(options.timer);
  root.append(row);

  return {
    setVisible(isVisible) {
      root.hidden = !isVisible;
    },
    setInteractive(isInteractive) {
      root.inert = !isInteractive;
    },
  };
}

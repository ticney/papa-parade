import { GAUGE_IDS, type GaugeId } from '@content/schemas/level';
import { GAUGE_CHANGE_HOLD_MS } from '@shared/constants';
import type { Translator } from '../strings.ts';
import { svgElement } from '../svg.ts';

type Doc = Pick<Document, 'createElement' | 'createElementNS'>;

export interface GaugesHud {
  /** The `hud-gauge` pill, for the `gauges` zone of the HUD: hidden while the level has no gauge. */
  readonly element: HTMLElement;
  /**
   * The gauges this level has (once per level, in the pill's order whatever `ids` says), each back
   * at 0 %. An empty list hides the pill.
   */
  setGauges(ids: readonly GaugeId[]): void;
  /**
   * A gauge's value in whole percent (0-100). The caller writes through `hudBatch`: only when the
   * integer changes, so at most every 2 s at 0.5 points per second. A gauge the level lacks is ignored.
   */
  setValue(id: GaugeId, percent: number): void;
  /**
   * Plays the 80 % alert on a gauge once (story 3.1): `pp-hud-gauge-alert` for `ALERT_HOLD_MS`, a
   * shake (a plain flash under reduced motion). A second call while it plays restarts it, on the
   * next `frame`. A gauge the level lacks is ignored.
   */
  alert(id: GaugeId): void;
  /** Once per frame: ends the « changing » hold and the alert of a gauge. Allocation-free. */
  frame(nowAtReal: number): void;
}

export interface GaugesHudOptions {
  t: Translator;
  /** Real time now (ms): stamps the changes. */
  nowAtReal(): number;
}

/** A gauge is orange from this share of its range (DESIGN: « from 70 % »; the sim's rules start strictly above, D12). */
const WARN_FROM_PCT = 70;
/** Below this share, an idle gauge is dimmed (EXPERIENCE: « under 50 % and idle »). */
const DIM_BELOW_PCT = 50;
/** A jump of at least this many points counts as a change, besides crossing a segment (D11). */
const JUMP_POINTS = 5;
/** The bar has ten segments: a boundary is crossed every 10 points. */
const SEGMENT_POINTS = 10;
const PERCENT_MAX = 100;
/** How long the alert class stays on, in real ms: the length of the CSS shake (`pp-gauge-shake`, a look, not a feel). */
const ALERT_HOLD_MS = 600;

// Literal keys on purpose: the architecture test checks every key against the strings file.
const LABEL_KEYS: Readonly<Record<GaugeId, string>> = {
  noise: 'gauge.noise',
  fatigue: 'gauge.fatigue',
  need: 'gauge.urge',
};

const path = (doc: Doc, d: string): SVGElement =>
  svgElement('path', { class: 'pp-hud-gauge-ink', d }, [], doc);

function icon(doc: Doc, children: readonly SVGElement[]): SVGSVGElement {
  return svgElement(
    'svg',
    { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
    children,
    doc,
  ) as SVGSVGElement;
}

/**
 * One icon per gauge (mockup `#i-bruit`, `#i-fatigue`, `#i-envie`): ink shapes, the colours come
 * from CSS classes that use the tokens. All three exist now, so that the noise (story 3.1) and the
 * need (epic 4) only add their system.
 */
const ICONS: Readonly<Record<GaugeId, (doc: Doc) => SVGSVGElement>> = {
  noise: (doc) =>
    icon(doc, [
      path(doc, 'M3 9h4l5-4v14l-5-4H3z'),
      svgElement(
        'path',
        {
          class: 'pp-hud-gauge-line',
          d: 'M15.5 8.5c1.6 1.2 1.6 5.8 0 7M18.5 6c3.2 2.6 3.2 9.4 0 12',
        },
        [],
        doc,
      ),
    ]),
  fatigue: (doc) =>
    icon(doc, [
      svgElement('path', { class: 'pp-hud-gauge-line', d: 'M2.5 12.5c3.5 5 15.5 5 19 0' }, [], doc),
      path(doc, 'M2.5 12.5c3.5-4.6 15.5-4.6 19 0c-4 1.6-15 1.6-19 0z'),
      svgElement('circle', { class: 'pp-hud-gauge-ink', cx: '12', cy: '15', r: '2.2' }, [], doc),
    ]),
  need: (doc) =>
    icon(doc, [
      path(doc, 'M12 2.5c3.2 5 6.5 8.2 6.5 12.2a6.5 6.5 0 0 1-13 0c0-4 3.3-7.2 6.5-12.2z'),
      svgElement('path', { class: 'pp-hud-gauge-drop', d: 'M9 15.5a3 3 0 0 0 3 3' }, [], doc),
    ]),
};

/** What the pill knows of one gauge: the DOM it writes and the state it last wrote. */
interface GaugeState {
  readonly id: GaugeId;
  readonly label: string;
  readonly element: HTMLElement;
  readonly fill: HTMLElement;
  percent: number;
  /** Whether a value was written since `setGauges` (the first one is no change). */
  hasValue: boolean;
  changedAtReal: number;
  isChanging: boolean;
  isWarn: boolean;
  isIdle: boolean;
  /** Whether the alert class is on (story 3.1). */
  isAlert: boolean;
  /** The alert state the element's classes were last written for. */
  isAlertOnElement: boolean;
  /** A second alert came while one played: the class goes off now and on again at the next frame. */
  isAlertRestarting: boolean;
  alertedAtReal: number;
}

/**
 * The HUD's gauges (UX-DR4, top-left): one paper pill with an ink outline holding one gauge per
 * system the level has, in the order Bruit · Fatigue · Envie. Each is an icon and a bar of ten
 * segments whose single fill element is scaled with `transform: scaleX(value / 100)`: no layout
 * property ever animates. The fill is calm below 70 %, warn from 70 % (the icon chip then also
 * rings and pulses, so the state never relies on hue alone). A gauge is dimmed (`pp-hud-gauge-idle`) while
 * under 50 % and not changing; « changing » means it crossed a 10-point segment boundary or jumped
 * by 5 points or more within the last `GAUGE_CHANGE_HOLD_MS` (D11). Class toggles and style writes
 * happen only when something changed; nothing is allocated per frame. `alert` (story 3.1) adds a
 * one-shot class for the 80 % noise cue, taken off by `frame` after `ALERT_HOLD_MS`.
 */
export function createGaugesHud(doc: Doc, options: GaugesHudOptions): GaugesHud {
  const { t, nowAtReal } = options;
  const element = doc.createElement('div');
  element.className = 'pp-hud-gauges';
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', t('hud.gauges'));
  element.hidden = true;
  let gauges: GaugeState[] = [];

  const stateOf = (id: GaugeId): GaugeState | undefined => {
    for (let i = 0; i < gauges.length; i++)
      if ((gauges[i] as GaugeState).id === id) return gauges[i];
    return undefined;
  };

  // The classes of a gauge, rewritten only when the warn or idle state changes.
  const applyClasses = (gauge: GaugeState): void => {
    const isIdle = gauge.percent < DIM_BELOW_PCT && !gauge.isChanging;
    const isWarn = gauge.percent >= WARN_FROM_PCT;
    const { isAlert } = gauge;
    if (isIdle === gauge.isIdle && isWarn === gauge.isWarn && isAlert === gauge.isAlertOnElement) {
      return;
    }
    gauge.isIdle = isIdle;
    gauge.isWarn = isWarn;
    gauge.isAlertOnElement = isAlert;
    gauge.element.className = `pp-hud-gauge${isIdle ? ' pp-hud-gauge-idle' : ''}${isWarn ? ' pp-hud-gauge-warn' : ''}${isAlert ? ' pp-hud-gauge-alert' : ''}`;
  };

  const build = (id: GaugeId): GaugeState => {
    const gauge = doc.createElement('div');
    const bar = doc.createElement('div');
    bar.className = 'pp-hud-gauge-bar';
    const fill = doc.createElement('div');
    fill.className = 'pp-hud-gauge-fill';
    fill.style.transform = 'scaleX(0)';
    bar.append(fill);
    gauge.append(ICONS[id](doc), bar);
    const label = t(LABEL_KEYS[id]);
    gauge.className = 'pp-hud-gauge pp-hud-gauge-idle';
    // An image with a name: a bare `div` cannot carry an `aria-label` that assistive tech reads.
    gauge.setAttribute('role', 'img');
    gauge.setAttribute('aria-label', `${label} 0 %`);
    return {
      id,
      label,
      element: gauge,
      fill,
      percent: 0,
      hasValue: false,
      changedAtReal: 0,
      isChanging: false,
      isWarn: false,
      isIdle: true,
      isAlert: false,
      isAlertOnElement: false,
      isAlertRestarting: false,
      alertedAtReal: 0,
    };
  };

  return {
    element,
    setGauges(ids) {
      gauges = GAUGE_IDS.filter((id) => ids.includes(id)).map(build);
      element.replaceChildren(...gauges.map((gauge) => gauge.element));
      element.hidden = gauges.length === 0;
    },
    setValue(id, percent) {
      const gauge = stateOf(id);
      if (gauge === undefined) return;
      const next = Math.max(0, Math.min(PERCENT_MAX, Math.round(percent)));
      if (gauge.hasValue && next === gauge.percent) return;
      const previous = gauge.percent;
      const isFirst = !gauge.hasValue;
      gauge.hasValue = true;
      gauge.percent = next;
      if (
        !isFirst &&
        (Math.floor(previous / SEGMENT_POINTS) !== Math.floor(next / SEGMENT_POINTS) ||
          Math.abs(next - previous) >= JUMP_POINTS)
      ) {
        gauge.isChanging = true;
        gauge.changedAtReal = nowAtReal();
      }
      gauge.fill.style.transform = `scaleX(${next / PERCENT_MAX})`;
      gauge.element.setAttribute('aria-label', `${gauge.label} ${next} %`);
      applyClasses(gauge);
    },
    alert(id) {
      const gauge = stateOf(id);
      if (gauge === undefined) return;
      if (gauge.isAlert) {
        // Off now, on at the next frame, with a style flush in between (see `frame`): the browser
        // restarts the animation on the new class.
        gauge.isAlert = false;
        gauge.isAlertRestarting = true;
      } else {
        gauge.isAlert = true;
        gauge.alertedAtReal = nowAtReal();
      }
      applyClasses(gauge);
    },
    frame(now) {
      for (let i = 0; i < gauges.length; i++) {
        const gauge = gauges[i] as GaugeState;
        if (gauge.isAlertRestarting) {
          // The class went off in `alert`, possibly in this very frame: reading a layout property
          // flushes the style, so the browser really sees « off » before « on » and replays the shake.
          void gauge.element.offsetWidth;
          gauge.isAlertRestarting = false;
          gauge.isAlert = true;
          gauge.alertedAtReal = now;
          applyClasses(gauge);
        } else if (gauge.isAlert && now - gauge.alertedAtReal >= ALERT_HOLD_MS) {
          gauge.isAlert = false;
          applyClasses(gauge);
        }
        if (!gauge.isChanging || now - gauge.changedAtReal < GAUGE_CHANGE_HOLD_MS) continue;
        gauge.isChanging = false;
        applyClasses(gauge);
      }
    },
  };
}

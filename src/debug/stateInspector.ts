import type { TestHost } from '@client/app/testHost';
import { DEBUG_PANEL_REFRESH_MS } from '@shared/constants';
import type { World } from '@sim';

/**
 * The one-glance summary of a world: sim time, time scale, flow, Papa, baby, fatigue and each
 * threat with its def and state. Pure and read-only; one string per line.
 */
export function summarizeWorld(world: Readonly<World>): string[] {
  const lines = [
    `t ${world.time.sim} ms · timeScale ${world.time.scale.toFixed(2)} (base ${world.time.baseScale.toFixed(2)}, ${world.time.slowMos.length} slow-mo)`,
    `flow ${world.flow.state} · papa ${world.papa.state} · baby ${world.baby.state}`,
    `fatigue ${world.gauges.fatigue.toFixed(1)}${world.gauges.isFatigueAbove ? ' (above threshold)' : ''}`,
  ];
  for (const threat of world.threats) {
    lines.push(`#${threat.id} ${threat.defId} @ ${threat.anchorId}: ${threat.state}`);
  }
  return lines;
}

/** The slices of the world the tree lists, in this order. `feel` is the effective feel. */
const SLICES = [
  'time',
  'papa',
  'baby',
  'threats',
  'director',
  'disruptions',
  'flow',
  'gauges',
  'props',
  'mess',
  'silence',
  'score',
  'feel',
] as const satisfies readonly (keyof World)[];

export interface StateInspector {
  /** Starts or stops refreshing (only while the overlay is open). Refreshes once at once. */
  setActive(isActive: boolean): void;
  dispose(): void;
}

export interface InspectorRoot {
  append(...nodes: Node[]): void;
  readonly ownerDocument: Pick<Document, 'createElement'>;
}

/**
 * A read-only view of `sim.world`: the summary, then one collapsible block of JSON per slice. It
 * reads the world through the running sim at each refresh and holds no reference to it between
 * two (a string is all it keeps), so it cannot write through anything. A slice's JSON is made
 * only when its block is open. Refreshes at the panel rate on level frames, only while active.
 */
export function createStateInspector(host: TestHost, root: InspectorRoot): StateInspector {
  const doc = root.ownerDocument;
  const container = doc.createElement('div');
  container.className = 'pp-debug-inspector';
  const summary = doc.createElement('pre');
  summary.className = 'pp-debug-inspector-summary';
  container.append(summary);
  const blocks = SLICES.map((name) => {
    const details = doc.createElement('details') as HTMLDetailsElement;
    details.className = 'pp-debug-slice';
    const title = doc.createElement('summary');
    title.textContent = name;
    const body = doc.createElement('pre');
    details.append(title, body);
    container.append(details);
    return { name, details, body };
  });
  root.append(container);

  let isActive = false;
  let lastRefreshAtReal = Number.NEGATIVE_INFINITY;
  const refresh = (): void => {
    const world = host.levelSession.active?.sim.world;
    if (world === undefined) {
      summary.textContent = 'no level is running';
      for (const block of blocks) block.body.textContent = '';
      return;
    }
    summary.textContent = summarizeWorld(world).join('\n');
    for (const block of blocks) {
      if (block.details.open) block.body.textContent = JSON.stringify(world[block.name], null, 1);
    }
  };
  const offFrame = host.onRenderedFrame((frameAtReal) => {
    if (!isActive || frameAtReal - lastRefreshAtReal < DEBUG_PANEL_REFRESH_MS) return;
    lastRefreshAtReal = frameAtReal;
    refresh();
  });
  // A new level, or the end of one (no frame is drawn on the Result screen): show it at once.
  const offStarted = host.onLevelStarted(() => {
    if (isActive) refresh();
  });
  const offEvents = host.onSimEvent((event) => {
    if (isActive && event.type === 'LevelEnded') refresh();
  });

  return {
    setActive(next) {
      isActive = next;
      if (next) refresh();
    },
    dispose() {
      offFrame();
      offStarted();
      offEvents();
      container.remove();
    },
  };
}

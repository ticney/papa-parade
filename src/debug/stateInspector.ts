import type { TestHost } from '@client/app/testHost';
import { DEBUG_PANEL_REFRESH_MS } from '@shared/constants';
import type { World } from '@sim';
import { guarded } from './guard.ts';

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

/** The slices of the world the blocks list, in this order. `feel` is the effective feel; `rng` and `nextId` are what a replay depends on. */
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
  'sequence',
  'score',
  'rng',
  'nextId',
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
 * only when its block is open. Refreshes at the panel rate on level frames, only while active. A
 * new level shows its own world at once (from the `StartedLevel`, since `levelSession.active` is
 * still the old one while the listeners run). A throw while refreshing is logged and goes no
 * further.
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
  const refresh = (known?: Readonly<World>): void => {
    const world = known ?? host.levelSession.active?.sim.world;
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
  const offFrame = host.onRenderedFrame(
    guarded('state inspector: refresh', (frameAtReal) => {
      if (!isActive || frameAtReal - lastRefreshAtReal < DEBUG_PANEL_REFRESH_MS) return;
      lastRefreshAtReal = frameAtReal;
      refresh();
    }),
  );
  // A new level, or the end of one (no frame is drawn on the Result screen): show it at once.
  const offStarted = host.onLevelStarted(
    guarded('state inspector: refresh on a new level', (started) => {
      if (isActive) refresh(started.sim.world);
    }),
  );
  const offEvents = host.onSimEvent(
    guarded('state inspector: refresh on the end of the level', (event) => {
      if (isActive && event.type === 'LevelEnded') refresh();
    }),
  );

  return {
    setActive: guarded('state inspector: opening', (next: boolean) => {
      isActive = next;
      if (next) {
        lastRefreshAtReal = Number.NEGATIVE_INFINITY;
        refresh();
      }
    }),
    dispose() {
      offFrame();
      offStarted();
      offEvents();
      container.remove();
    },
  };
}

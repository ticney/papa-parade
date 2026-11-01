import { readFileSync } from 'node:fs';
import { parseContentFile } from '@content/parseContentFile';
import { SequenceDefSchema } from '@content/schemas/sequence';
import { THREAT_ICONS, ThreatDefSchema } from '@content/schemas/threat';
import { MIN_TIME_SCALE } from '@shared/constants';
import { describe, expect, it } from 'vitest';

// The `release` Firmness of the threat schema and the bomb drop's sequence keys (story 4.8). The
// frozen defs stand in for the live ones: tunable values are never pinned here.
const fixture = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../support/${file}`, import.meta.url), 'utf8'));
const lay = fixture('testBombDrop.threat.json');
const bombDrop = fixture('testBombDrop.sequence.json');
const eyes = fixture('testBedtimeEyes.threat.json');
const outlet = JSON.parse(
  readFileSync(new URL('../../content/threats/outlet.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

function parse(value: unknown) {
  return parseContentFile('content/threats/x.json', JSON.stringify(value), ThreatDefSchema);
}

function parseSequence(value: unknown) {
  return parseContentFile('content/sequences/x.json', JSON.stringify(value), SequenceDefSchema);
}

/** Applies `[path, value]` changes to a copy (`undefined` deletes the key) and lists the paths that fail. */
function mutate(
  schema: 'threat' | 'sequence',
  base: Record<string, unknown>,
  ...changes: [path: string, value: unknown][]
): string[] {
  const copy = structuredClone(base);
  for (const [path, value] of changes) {
    const names = path.split('.');
    const key = names.pop() as string;
    let node: Record<string, unknown> = copy;
    for (const name of names) {
      node = (Array.isArray(node) ? node[Number(name)] : node[name]) as Record<string, unknown>;
    }
    if (value === undefined) delete node[key];
    else node[key] = value;
  }
  const result = schema === 'threat' ? parse(copy) : parseSequence(copy);
  return result.ok ? [] : result.error.map((problem) => problem.jsonPath);
}

const mutatedThreat = (base: Record<string, unknown>, ...changes: [string, unknown][]) =>
  mutate('threat', base, ...changes);
const mutatedSequence = (base: Record<string, unknown>, ...changes: [string, unknown][]) =>
  mutate('sequence', base, ...changes);

describe('a firm threat judged on its release (story 4.8)', () => {
  it('parses, and carries its release and its signal', () => {
    const parsed = parse(lay);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.value.release).toEqual({ pressWithinMs: 700 });
    expect(parsed.value.signalIcon).toBe('open_hand');
    expect(parsed.value.feedback.signal).toBe('bomb_drop_touchdown');
  });

  it('knows the sweat and open_hand icons', () => {
    expect(THREAT_ICONS).toContain('sweat');
    expect(THREAT_ICONS).toContain('open_hand');
  });

  it('still parses a plain firm, a wait and a parry', () => {
    const firm = { ...structuredClone(outlet), response: 'firm', holdUntilMs: 1500 };
    expect(mutatedThreat(firm)).toEqual([]);
    expect(mutatedThreat(eyes)).toEqual([]);
    expect(mutatedThreat(outlet)).toEqual([]);
  });

  it.each([
    ['a release on a parry', outlet, [['release', { pressWithinMs: 100 }]], ['release']],
    ['a release on a wait', eyes, [['release', { pressWithinMs: 100 }]], ['release']],
    ['a release with a holdUntilMs', lay, [['holdUntilMs', 1500]], ['holdUntilMs']],
    [
      'a firm with neither holdUntilMs nor release',
      lay,
      [['release', undefined]],
      ['holdUntilMs', 'signalVerbKey', 'signalIcon', 'feedback.signal'],
    ],
    ['a zero pressWithinMs', lay, [['release.pressWithinMs', 0]], ['release.pressWithinMs']],
    [
      'a fractional pressWithinMs',
      lay,
      [['release.pressWithinMs', 700.5]],
      ['release.pressWithinMs'],
    ],
    [
      'a missing pressWithinMs',
      lay,
      [['release.pressWithinMs', undefined]],
      ['release.pressWithinMs'],
    ],
    ['an unknown release key', lay, [['release.extra', 1]], ['release.extra']],
    [
      'a pressWithinMs equal to telegraphDelayMs',
      lay,
      [['release.pressWithinMs', 2600]],
      ['release.pressWithinMs'],
    ],
    [
      'a pressWithinMs above telegraphDelayMs',
      lay,
      [['release.pressWithinMs', 3000]],
      ['release.pressWithinMs'],
    ],
    ['a release def on an anchor', lay, [['target', 'anchor']], ['release']],
    ['a null telegraphDelayMs', lay, [['telegraphDelayMs', null]], ['telegraphDelayMs']],
    ['a missing signalVerbKey', lay, [['signalVerbKey', undefined]], ['signalVerbKey']],
    ['a missing signalIcon', lay, [['signalIcon', undefined]], ['signalIcon']],
    ['a missing feedback.signal', lay, [['feedback.signal', undefined]], ['feedback.signal']],
  ] as const)('rejects %s', (_name, base, changes, expected) => {
    expect(mutatedThreat(base, ...(changes as unknown as [string, unknown][]))).toEqual(expected);
  });

  it('still refuses a signal key on a parry, and minDelayMs on a release def', () => {
    expect(mutatedThreat(outlet, ['signalIcon', 'eyes'])).toEqual(['signalIcon']);
    expect(mutatedThreat(outlet, ['feedback.signal', 'x_cue'])).toEqual(['feedback.signal']);
    expect(mutatedThreat(lay, ['minDelayMs', 1000])).toEqual(['minDelayMs']);
    expect(mutatedThreat(lay, ['maxDelayMs', 1000])).toEqual(['maxDelayMs']);
  });
});

describe('the bomb drop sequence (story 4.8)', () => {
  it('parses, with its slow motion and its babyLaid success', () => {
    const parsed = parseSequence(bombDrop);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.value.success.kind).toBe('babyLaid');
    expect(parsed.value.steps[0]).toMatchObject({ slowMo: { timeScale: 0.4, returnMs: 400 } });
  });

  it.each([
    ['babyLaid with no baby carried', [['babyCarried', false]], ['babyCarried']],
    [
      'babyLaid with another failure',
      [['failure', { kind: 'gag', hasSnore: false }]],
      ['failure.kind'],
    ],
    ['a slowMo timeScale of 0', [['steps.0.slowMo.timeScale', 0]], ['steps[0].slowMo.timeScale']],
    ['a slowMo timeScale of 1', [['steps.0.slowMo.timeScale', 1]], ['steps[0].slowMo.timeScale']],
    [
      'a slowMo timeScale below the slowest the sim runs',
      [['steps.0.slowMo.timeScale', MIN_TIME_SCALE / 2]],
      ['steps[0].slowMo.timeScale'],
    ],
    [
      'a slowMo timeScale above 1',
      [['steps.0.slowMo.timeScale', 1.5]],
      ['steps[0].slowMo.timeScale'],
    ],
    ['a negative returnMs', [['steps.0.slowMo.returnMs', -1]], ['steps[0].slowMo.returnMs']],
    ['a fractional returnMs', [['steps.0.slowMo.returnMs', 10.5]], ['steps[0].slowMo.returnMs']],
    [
      'a missing timeScale',
      [['steps.0.slowMo.timeScale', undefined]],
      ['steps[0].slowMo.timeScale'],
    ],
    ['an unknown slowMo key', [['steps.0.slowMo.durationMs', 100]], ['steps[0].slowMo.durationMs']],
  ] as const)('rejects %s', (_name, changes, expected) => {
    expect(mutatedSequence(bombDrop, ...(changes as unknown as [string, unknown][]))).toEqual(
      expected,
    );
  });

  it('accepts a step with no slowMo', () => {
    expect(mutatedSequence(bombDrop, ['steps.0.slowMo', undefined])).toEqual([]);
  });
});

describe('the live bomb drop (story 4.8)', () => {
  // A relation between two tunable values, not a pinned value: a cry that outlasts the rest would
  // cover the cue of the next descent.
  it('rests at least as long as the cry of its gag', () => {
    const live = (file: string): Record<string, unknown> =>
      JSON.parse(readFileSync(new URL(`../../content/${file}`, import.meta.url), 'utf8'));
    const liveLay = live('threats/bomb_drop_lay.json');
    const liveDrop = live('sequences/bomb_drop.json') as {
      steps: { kind: string; restMs?: number }[];
    };
    expect(typeof liveLay.gagCryMs).toBe('number');
    for (const liveStep of liveDrop.steps.filter((candidate) => candidate.kind === 'duel')) {
      expect(liveStep.restMs).toBeGreaterThanOrEqual(liveLay.gagCryMs as number);
    }
  });
});

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashJson } from '@shared/hash';
import { type Journal, replayJournal } from '@sim';
import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';
import { recordScenario, SCENARIOS, summarize } from './scenarios.ts';

const journalsDir = join(dirname(fileURLToPath(import.meta.url)), 'journals');
const UPDATE = process.env.GOLDEN_UPDATE === '1';
// `CI=false` or an empty value is not a CI: only a truthy-looking value counts.
const ON_CI = !['', '0', 'false'].includes(process.env.CI ?? '');
const content = createTestContent();
const geometry = createTestGeometry();

if (UPDATE && ON_CI) {
  throw new Error(
    'GOLDEN_UPDATE is refused on CI: references are regenerated locally and committed',
  );
}

const MISSING = (file: string) =>
  `missing golden file ${file}: run \`npm run golden:update\`, review the diff and commit it`;
const writeJson = (file: string, value: unknown) =>
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const readJson = <T>(file: string): T => {
  if (!existsSync(file)) throw new Error(MISSING(file));
  return JSON.parse(readFileSync(file, 'utf8')) as T;
};

describe.each(SCENARIOS)('golden: $name', (scenario) => {
  const journalFile = join(journalsDir, `${scenario.name}.json`);
  const expectedFile = join(journalsDir, `${scenario.name}.expected.json`);

  if (UPDATE) {
    it('regenerates the references (GOLDEN_UPDATE=1)', async () => {
      const recording = await recordScenario(content, geometry, scenario);
      writeJson(journalFile, recording.journal);
      writeJson(
        expectedFile,
        summarize(scenario.untilSimMs, recording.worldHash, recording.events),
      );
    });
    return;
  }

  it('recording the scenario again gives exactly the committed journal', async () => {
    const recording = await recordScenario(content, geometry, scenario);
    expect(recording.journal).toEqual(readJson<Journal>(journalFile));
  });

  it('replaying the committed journal gives the committed hash and events', async () => {
    const journal = readJson<Journal>(journalFile);
    const expected = readJson<ReturnType<typeof summarize>>(expectedFile);
    const replay = await replayJournal({
      content,
      geometry,
      level: scenario.level,
      journal,
      untilSimMs: expected.untilSimMs,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    const actual = summarize(
      expected.untilSimMs,
      hashJson(replay.value.sim.world),
      replay.value.events,
    );
    replay.value.sim.dispose();
    expect(actual).toEqual(expected);
  });

  it('the live run and the replay agree', async () => {
    const recording = await recordScenario(content, geometry, scenario);
    const replay = await replayJournal({
      content,
      geometry,
      level: scenario.level,
      journal: recording.journal,
      untilSimMs: scenario.untilSimMs,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(hashJson(replay.value.sim.world)).toBe(recording.worldHash);
    expect(replay.value.events).toEqual(recording.events);
    replay.value.sim.dispose();
  });
});

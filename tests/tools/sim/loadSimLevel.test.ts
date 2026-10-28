import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashJson } from '@shared/hash';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSimLevel } from '../../../tools/sim/loadSimLevel.ts';

const LIVE_DIR = fileURLToPath(new URL('../../../content', import.meta.url));
const copies: string[] = [];

/** A copy of the live content folder whose salon level has `feelOverrides`. */
function withOverrides(feelOverrides: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'pp-content-'));
  copies.push(dir);
  cpSync(LIVE_DIR, dir, { recursive: true });
  const file = join(dir, 'levels', 'salon_crawler.json');
  const level = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  level.feelOverrides = feelOverrides;
  writeFileSync(file, JSON.stringify(level));
  return dir;
}

afterEach(() => {
  for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('loadSimLevel and the level’s feelOverrides (story 1.18)', () => {
  it('hands over the live feel as is when the level overrides nothing', async () => {
    const live = await loadSimLevel(LIVE_DIR, 'salon_crawler');
    expect(live.ok).toBe(true);
    if (!live.ok) return;
    const base = JSON.parse(readFileSync(join(LIVE_DIR, 'feel.json'), 'utf8')) as {
      timing: { windowMs: number };
    };
    expect(live.value.content.feel.timing.windowMs).toBe(base.timing.windowMs);
  });

  it('merges the overrides into the feel the sim, the bots and the hashes see', async () => {
    const live = await loadSimLevel(LIVE_DIR, 'salon_crawler');
    const dir = withOverrides({ timing: { windowMs: 250 } });
    const merged = await loadSimLevel(dir, 'salon_crawler');
    if (!live.ok || !merged.ok) throw new Error('load failed');
    expect(merged.value.content.feel.timing.windowMs).toBe(250);
    // The rest of the feel is the base one, and the hash moved with the merge.
    expect(merged.value.content.feel.timing.toleranceMs).toBe(
      live.value.content.feel.timing.toleranceMs,
    );
    expect(hashJson(merged.value.content.feel)).not.toBe(hashJson(live.value.content.feel));
  });

  it('fails with the problems when an override breaks the feel', async () => {
    const dir = withOverrides({ timing: { windowMs: -5 } });
    const result = await loadSimLevel(dir, 'salon_crawler');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('feelOverrides');
      expect(result.error).toContain('timing.windowMs');
    }
  });
});

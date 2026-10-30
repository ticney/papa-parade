import { describe, expect, it } from 'vitest';
import { createBrowserContentSource } from './browserContentSource.ts';

describe('createBrowserContentSource', () => {
  it('serves a game content file', async () => {
    const result = await createBrowserContentSource().read('feel.json');
    expect(result.ok).toBe(true);
  });

  it('does not bundle content/playtest.json: it is a tool-only file', async () => {
    const result = await createBrowserContentSource().read('playtest.json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('is not bundled');
  });
});

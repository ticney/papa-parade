import type { LogChannel } from '@shared/log';
import { describe, expect, it } from 'vitest';
import { FONT_LOADS, loadFonts } from './fonts.ts';

function setup() {
  const warnings: string[] = [];
  const logger = {
    warn: (_channel: LogChannel, message: string) => {
      warnings.push(message);
    },
  };
  return { warnings, logger };
}

describe('loadFonts', () => {
  it('asks for every family and succeeds when they all load', async () => {
    const { warnings, logger } = setup();
    const asked: string[] = [];
    const result = await loadFonts(
      {
        load: (font) => {
          asked.push(font);
          return Promise.resolve([{}]);
        },
      },
      logger,
    );
    expect(result.ok).toBe(true);
    expect(asked.sort()).toEqual([...FONT_LOADS].sort());
    expect(warnings).toEqual([]);
  });

  it('returns an error and warns once when a family fails to load', async () => {
    const { warnings, logger } = setup();
    const result = await loadFonts(
      {
        load: (font) =>
          font.includes('Anton')
            ? Promise.reject(new Error('network down'))
            : Promise.resolve([{}]),
      },
      logger,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('assets');
      expect(JSON.stringify(result.error.cause)).toContain('network down');
    }
    expect(warnings).toHaveLength(1);
  });

  it('treats a request that matches no @font-face as a failure', async () => {
    const { warnings, logger } = setup();
    const result = await loadFonts({ load: () => Promise.resolve([]) }, logger);
    expect(result.ok).toBe(false);
    expect(warnings).toHaveLength(1);
  });

  it('keeps going when a load throws something that is not an Error', async () => {
    const { logger } = setup();
    const result = await loadFonts({ load: () => Promise.reject('boom') }, logger);
    expect(result.ok).toBe(false);
  });
});

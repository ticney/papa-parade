import { log } from '@shared/log';
import { beforeAll, describe, expect, it } from 'vitest';
import { createFakeAudioContext } from '../../../tests/support/fakeAudioContext.ts';
import { unlockAudioContext } from './audioUnlock.ts';

beforeAll(() => {
  log.setLevel('error');
});

describe('unlockAudioContext', () => {
  it('creates the context, resumes it and starts one silent buffer, all in the same call', () => {
    const fake = createFakeAudioContext();
    let created = 0;
    const result = unlockAudioContext(() => {
      created++;
      return fake;
    });
    expect(result).toMatchObject({ ok: true, value: fake });
    expect(created).toBe(1);
    expect(fake.calls).toContain('resume');
    expect(fake.buffers).toEqual([{ channelCount: 1, length: 1, sampleRateHz: 22_050 }]);
    expect(fake.sources).toHaveLength(1);
    expect(fake.sources[0]?.startCalls).toEqual([0]);
    expect(fake.sources[0]?.connections).toEqual([fake.destination]);
  });

  it('is an err that names the cause when the constructor throws', () => {
    const result = unlockAudioContext(() => {
      throw new Error('no Web Audio');
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'audio', message: 'audio unlock failed: no Web Audio' },
    });
  });

  it('does not wait for resume(): a rejection is caught, not thrown', async () => {
    const fake = createFakeAudioContext();
    fake.failures.resume = new Error('not allowed');
    const result = unlockAudioContext(() => fake);
    expect(result.ok).toBe(true);
    await Promise.resolve(); // the caught rejection settles without an unhandled rejection
  });

  it('survives a silent buffer that cannot be made: still an unlocked context', () => {
    const fake = createFakeAudioContext();
    fake.failures.createBuffer = new Error('bad buffer');
    expect(unlockAudioContext(() => fake).ok).toBe(true);
  });
});

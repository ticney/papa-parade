import { describe, expect, it } from 'vitest';
import { createFakeAudioContext } from './fakeAudioContext.ts';

// The double must refuse what Web Audio refuses, or the engine tests pass where a browser throws.
describe('createFakeAudioContext', () => {
  it('throws InvalidStateError when a source is started twice', () => {
    const source = createFakeAudioContext().createBufferSource();
    source.start(0);
    expect(() => source.start(0)).toThrowError(
      expect.objectContaining({ name: 'InvalidStateError' }),
    );
  });

  it('throws InvalidStateError when a source is stopped before it was started', () => {
    const source = createFakeAudioContext().createBufferSource();
    expect(() => source.stop(0)).toThrowError(
      expect.objectContaining({ name: 'InvalidStateError' }),
    );
    source.start(0);
    expect(() => source.stop(1)).not.toThrow();
  });

  it('rejects resume() on a closed context, and resumes a suspended one', async () => {
    const context = createFakeAudioContext();
    await context.resume();
    expect(context.state).toBe('running');
    await context.close();
    expect(context.state).toBe('closed');
    await expect(context.resume()).rejects.toMatchObject({ name: 'InvalidStateError' });
    expect(context.state).toBe('closed');
  });
});

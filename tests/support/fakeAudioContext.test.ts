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

  it('records the filters it builds, and gives every source a recording playbackRate', () => {
    const context = createFakeAudioContext();
    context.createBiquadFilter();
    const [filter] = context.filters;
    if (filter === undefined) throw new Error('no filter recorded');
    expect(filter.type).toBe('lowpass');
    filter.frequency.linearRampToValueAtTime(900, 1);
    expect(filter.frequency.events).toEqual([{ kind: 'ramp', value: 900, timeS: 1 }]);
    context.createBufferSource();
    context.createBufferSource();
    const [a, b] = context.sources;
    expect(a?.playbackRate.value).toBe(1);
    a?.playbackRate.setValueAtTime(0.8, 0);
    expect(a?.playbackRate.events).toHaveLength(1);
    expect(b?.playbackRate.events).toHaveLength(0);
  });

  it('throws from createBiquadFilter on demand', () => {
    const context = createFakeAudioContext();
    context.failures.createBiquadFilter = new Error('no filter');
    expect(() => context.createBiquadFilter()).toThrowError('no filter');
    expect(context.filters).toHaveLength(0);
  });
});

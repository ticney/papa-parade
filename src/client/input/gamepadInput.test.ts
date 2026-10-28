import { log } from '@shared/log';
import { describe, expect, it } from 'vitest';
import {
  createGamepadInput,
  createPadState,
  type GamepadLike,
  type PadButton,
  padFamily,
  type StickAxes,
} from './gamepadInput.ts';

const pad = (x: number, y: number, connected = true): GamepadLike => ({
  connected,
  axes: [x, y, 0, 0],
});

function poll(pads: (GamepadLike | null | undefined)[]): StickAxes {
  const out: StickAxes = { x: 9, y: 9 };
  createGamepadInput(() => pads).poll(out);
  return out;
}

describe('createGamepadInput', () => {
  it('reads the left stick of the first connected pad', () => {
    expect(poll([pad(0.5, -0.25)])).toEqual({ x: 0.5, y: -0.25 });
  });

  it('skips empty slots and disconnected pads', () => {
    expect(poll([null, undefined, pad(1, 1, false), pad(-0.3, 0.8)])).toEqual({ x: -0.3, y: 0.8 });
  });

  it('prefers a pad with the standard mapping over an earlier device of another kind', () => {
    const wheel: GamepadLike = { connected: true, axes: [0.9, 0.9], mapping: '' };
    const standard: GamepadLike = { connected: true, axes: [-0.5, 0.2], mapping: 'standard' };
    expect(poll([wheel, standard])).toEqual({ x: -0.5, y: 0.2 });
    expect(poll([wheel])).toEqual({ x: 0.9, y: 0.9 }); // better than no pad at all
  });

  it('is (0, 0) with no pad at all, and when the pad disappears', () => {
    expect(poll([])).toEqual({ x: 0, y: 0 });
    expect(poll([null, null])).toEqual({ x: 0, y: 0 });
    let pads: (GamepadLike | null)[] = [pad(0.9, 0)];
    const input = createGamepadInput(() => pads);
    const out: StickAxes = { x: 0, y: 0 };
    input.poll(out);
    expect(out.x).toBe(0.9);
    pads = [null];
    input.poll(out);
    expect(out).toEqual({ x: 0, y: 0 });
  });

  it('ignores a pad that reports no stick, and a value that is not a number', () => {
    expect(poll([{ connected: true, axes: [] }, pad(0.4, 0.4)])).toEqual({ x: 0.4, y: 0.4 });
    expect(poll([pad(Number.NaN, Number.POSITIVE_INFINITY)])).toEqual({ x: 0, y: 0 });
  });

  it('asks for the pads at each poll and keeps none between two', () => {
    let calls = 0;
    const input = createGamepadInput(() => {
      calls++;
      return [pad(calls, 0)];
    });
    const out: StickAxes = { x: 0, y: 0 };
    input.poll(out);
    input.poll(out);
    expect(calls).toBe(2);
    expect(out.x).toBe(2);
  });
});

// A standard pad whose `down` buttons are given by index, with the id and timestamp of the test.
function standardPad(down: readonly number[] = [], extra: Partial<GamepadLike> = {}): GamepadLike {
  return {
    connected: true,
    axes: [0, 0, 0, 0],
    mapping: 'standard',
    id: 'Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)',
    timestamp: 0,
    buttons: Array.from({ length: 17 }, (_unused, index) => ({ pressed: down.includes(index) })),
    ...extra,
  };
}

function session(initial: (GamepadLike | null)[] = [], now = 1000) {
  let pads = initial;
  let clock = now;
  const input = createGamepadInput(
    () => pads,
    () => clock,
  );
  const stick: StickAxes = { x: 0, y: 0 };
  const state = createPadState();
  return {
    state,
    stick,
    set(next: (GamepadLike | null)[]) {
      pads = next;
    },
    setNow(value: number) {
      clock = value;
    },
    poll() {
      input.poll(stick, state);
      return state;
    },
  };
}

const pressedNow = (state: ReturnType<typeof createPadState>) =>
  (Object.keys(state.pressed) as PadButton[]).filter((button) => state.pressed[button]);
const releasedNow = (state: ReturnType<typeof createPadState>) =>
  (Object.keys(state.released) as PadButton[]).filter((button) => state.released[button]);

describe('padFamily (D11 of story 1.17)', () => {
  it.each([
    [
      'a DualSense in Chrome',
      'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',
      'playstation',
    ],
    ['a pad in Firefox', '054c-0ce6-DualSense Wireless Controller', 'playstation'],
    ['a non-Sony pad with 054c as its product id', 'Pad (Vendor: 045e Product: 054c)', 'xbox'],
    ['a pad whose Firefox product id is 054c', '045e-054c-Generic Pad', 'xbox'],
    ['a DualShock by name', 'Wireless Controller DUALSHOCK 4', 'playstation'],
    ['a PlayStation pad by name', 'PlayStation(R)3 Controller', 'playstation'],
    ['an Xbox pad', 'Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)', 'xbox'],
    [
      'a Nintendo pad (read as Xbox)',
      'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)',
      'xbox',
    ],
    ['an empty id', '', 'xbox'],
  ])('reads %s', (_name, id, family) => {
    expect(padFamily(id)).toBe(family);
  });
});

describe('createGamepadInput: presence and family (story 1.17)', () => {
  it('is absent with no pad, present with one, and absent again when it goes', () => {
    const run = session();
    expect(run.poll().isPresent).toBe(false);
    run.set([standardPad()]);
    expect(run.poll().isPresent).toBe(true);
    run.set([null]);
    expect(run.poll().isPresent).toBe(false);
    run.set([{ ...standardPad(), connected: false }]);
    expect(run.poll().isPresent).toBe(false);
  });

  it('is present for a non-standard pad that has a stick, and reads its family', () => {
    const run = session([{ connected: true, axes: [0.5, 0], mapping: '', id: '054c-0ce6-pad' }]);
    expect(run.poll()).toMatchObject({ isPresent: true, family: 'playstation' });
    expect(run.stick.x).toBe(0.5);
  });

  it('follows the selected pad: the family changes with it', () => {
    const run = session([standardPad([], { id: 'DualSense (Vendor: 054c)' })]);
    expect(run.poll().family).toBe('playstation');
    run.set([standardPad([], { id: 'Xbox One' })]);
    expect(run.poll().family).toBe('xbox');
  });

  it('works without a state object, as the stick-only callers do', () => {
    const input = createGamepadInput(() => [standardPad()]);
    const stick: StickAxes = { x: 9, y: 9 };
    expect(() => input.poll(stick)).not.toThrow();
    expect(stick).toEqual({ x: 0, y: 0 });
  });
});

describe('createGamepadInput: button edges (story 1.17)', () => {
  it('sees a press, the hold as nothing, the release and a re-press', () => {
    const run = session([standardPad()]);
    run.poll(); // selects the pad
    run.set([standardPad([0])]);
    expect(pressedNow(run.poll())).toEqual(['confirm']);
    run.set([standardPad([0])]);
    const held = run.poll();
    expect(pressedNow(held)).toEqual([]);
    expect(releasedNow(held)).toEqual([]);
    run.set([standardPad([])]);
    expect(releasedNow(run.poll())).toEqual(['confirm']);
    expect(releasedNow(run.poll())).toEqual([]);
    run.set([standardPad([0])]);
    expect(pressedNow(run.poll())).toEqual(['confirm']);
  });

  it.each([
    [0, 'confirm'],
    [1, 'back'],
    [9, 'start'],
    [12, 'up'],
    [13, 'down'],
    [14, 'left'],
    [15, 'right'],
  ] as const)('maps standard button %i to %s', (index, name) => {
    const run = session([standardPad()]);
    run.poll();
    run.set([standardPad([index])]);
    expect(pressedNow(run.poll())).toEqual([name]);
  });

  it('ignores the other buttons', () => {
    const run = session([standardPad()]);
    run.poll();
    run.set([standardPad([2, 3, 4, 5, 8, 10, 11, 16])]);
    expect(pressedNow(run.poll())).toEqual([]);
  });

  it('reads several buttons in one poll', () => {
    const run = session([standardPad()]);
    run.poll();
    run.set([standardPad([0, 9])]);
    expect(pressedNow(run.poll())).toEqual(['confirm', 'start']);
  });

  it('does not read a button held when the pad is first seen as a new press', () => {
    const run = session();
    run.poll();
    run.set([standardPad([0])]);
    expect(pressedNow(run.poll())).toEqual([]);
    run.set([standardPad([])]);
    expect(releasedNow(run.poll())).toEqual(['confirm']);
  });

  it('does not read a button held on another pad as a new press when the selected pad changes', () => {
    const second = standardPad([], { id: 'Xbox One' });
    const run = session([standardPad([0]), second]);
    run.poll();
    // The first pad is unplugged while A is held on the second: the second becomes the pad.
    run.set([null, standardPad([0], { id: 'Xbox One' })]);
    expect(pressedNow(run.poll())).toEqual([]);
    run.set([null, standardPad([], { id: 'Xbox One' })]);
    expect(releasedNow(run.poll())).toEqual(['confirm']);
  });

  it('releases what was held when the pad goes away, stamped now', () => {
    const run = session([standardPad([0, 9])], 1000);
    run.poll();
    run.set([]);
    run.setNow(1500);
    const state = run.poll();
    expect(releasedNow(state).sort()).toEqual(['confirm', 'start']);
    expect(state.isPresent).toBe(false);
    expect(state.stampAtReal).toBe(1500);
    expect(releasedNow(run.poll())).toEqual([]); // once
  });

  it('releases what the old pad held when another pad takes over', () => {
    const run = session([standardPad([0])]);
    run.poll();
    run.set([null, standardPad([], { id: 'Xbox One' })]);
    expect(releasedNow(run.poll())).toEqual(['confirm']);
  });

  it('releases nothing when the pad goes away with nothing held', () => {
    const run = session([standardPad([])]);
    run.poll();
    run.set([]);
    expect(releasedNow(run.poll())).toEqual([]);
  });

  it('forgets the buttons of a pad that went away: a pad plugged in later starts from scratch', () => {
    const run = session([standardPad([0])]);
    run.poll();
    run.set([]);
    run.poll();
    run.set([standardPad([0])]);
    expect(pressedNow(run.poll())).toEqual([]);
  });

  it('reads no button on a non-standard pad, and says so once per pad id', () => {
    const before = log.buffer().length;
    const odd = (down: boolean): GamepadLike => ({
      connected: true,
      axes: [0.25, 0],
      mapping: '',
      id: 'Odd Pad 9000',
      buttons: Array.from({ length: 17 }, () => ({ pressed: down })),
    });
    const run = session([odd(false)]);
    run.poll();
    run.set([odd(true)]);
    const state = run.poll();
    expect(pressedNow(state)).toEqual([]);
    expect(state.isPresent).toBe(true);
    expect(run.stick.x).toBe(0.25);
    const warnings = log
      .buffer()
      .slice(before)
      .filter((entry) => entry.level === 'warn' && entry.message.includes('no standard mapping'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.data).toEqual({ id: 'Odd Pad 9000' });
  });

  it('copes with a standard pad that reports fewer buttons', () => {
    const run = session([standardPad()]);
    run.poll();
    run.set([{ ...standardPad(), buttons: [{ pressed: true }] }]);
    expect(pressedNow(run.poll())).toEqual(['confirm']);
    run.set([{ ...standardPad(), buttons: undefined }]);
    expect(releasedNow(run.poll())).toEqual(['confirm']);
  });
});

describe('createGamepadInput: the press stamp (D5 of story 1.17)', () => {
  const pressWith = (timestamp: number | undefined, now = 1000) => {
    const run = session([standardPad()], now);
    run.poll();
    run.set([standardPad([0], { timestamp })]);
    return run.poll().stampAtReal;
  };

  it("uses the pad's own timestamp when it is recent, not in the future and above 0", () => {
    expect(pressWith(960)).toBe(960);
    expect(pressWith(1000)).toBe(1000);
    expect(pressWith(900)).toBe(900); // exactly the max age
  });

  it('uses now when the pad timestamp is stale, in the future, 0, not finite or absent', () => {
    expect(pressWith(899)).toBe(1000);
    expect(pressWith(1001)).toBe(1000);
    expect(pressWith(0)).toBe(1000);
    expect(pressWith(-5)).toBe(1000);
    expect(pressWith(Number.NaN)).toBe(1000);
    expect(pressWith(Number.POSITIVE_INFINITY)).toBe(1000);
    expect(pressWith(undefined)).toBe(1000);
  });

  it('stamps a poll with no edge with now', () => {
    const run = session([standardPad([], { timestamp: 990 })]);
    expect(run.poll().stampAtReal).toBe(1000);
  });
});

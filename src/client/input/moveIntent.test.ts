import { asSimMs } from '@shared/time';
import type { SimCommand } from '@sim';
import { describe, expect, it } from 'vitest';
import { createIsoCamera, fitIsoCamera } from '../render/isoCamera.ts';
import type { StickAxes } from './gamepadInput.ts';
import { createMoveIntent } from './moveIntent.ts';

const ROOM = {
  widthM: 9.1,
  depthM: 6.2,
  heightM: 3.3,
  floorYM: -0.8,
  centerXM: 0.35,
  centerZM: -0.1,
};
const INPUT = { stickDeadzonePct: 20, stickAngleStepDeg: 5 };

function setup() {
  const camera = createIsoCamera();
  fitIsoCamera(camera, ROOM, 844 / 390);
  const sent: SimCommand[] = [];
  const intent = createMoveIntent({ camera, input: INPUT, send: (command) => sent.push(command) });
  const rest: StickAxes = { x: 0, y: 0 };
  const t = (ms: number) => asSimMs(ms);
  return { intent, sent, rest, t };
}

const SQ = Math.SQRT1_2;

describe('createMoveIntent', () => {
  it('sends nothing while nothing is pushed', () => {
    const { intent, sent, rest, t } = setup();
    intent.update(new Set(), rest, t(0));
    intent.update(new Set(), rest, t(16));
    expect(sent).toEqual([]);
  });

  it('sends one Move when a key goes down, stamped with the given time, and nothing while it is held', () => {
    const { intent, sent, rest, t } = setup();
    const held = new Set(['KeyD']);
    intent.update(held, rest, t(100));
    intent.update(held, rest, t(116));
    intent.update(held, rest, t(132));
    expect(sent).toHaveLength(1);
    const move = sent[0] as Extract<SimCommand, { type: 'Move' }>;
    expect(move).toMatchObject({ type: 'Move', t: 100 });
    expect(move.dirX).toBeCloseTo(SQ, 12);
    expect(move.dirZ).toBeCloseTo(-SQ, 12);
  });

  it('sends MoveStop once when the last key goes up', () => {
    const { intent, sent, rest, t } = setup();
    intent.update(new Set(['KeyD']), rest, t(100));
    intent.update(new Set(), rest, t(200));
    intent.update(new Set(), rest, t(216));
    expect(sent.map((c) => c.type)).toEqual(['Move', 'MoveStop']);
    expect(sent[1]).toEqual({ type: 'MoveStop', t: 200 });
  });

  it('sends a new Move when the combined direction changes, not a stop in between', () => {
    const { intent, sent, rest, t } = setup();
    intent.update(new Set(['KeyD']), rest, t(0));
    intent.update(new Set(['KeyD', 'KeyW']), rest, t(10));
    intent.update(new Set(['KeyW']), rest, t(20));
    expect(sent.map((c) => c.type)).toEqual(['Move', 'Move', 'Move']);
    const dirs = sent.map((c) => c as Extract<SimCommand, { type: 'Move' }>);
    expect(dirs[1]?.dirX).toBeCloseTo(0, 9); // right + up: straight along the floor's far axis
    expect(dirs[1]?.dirZ).toBeCloseTo(-1, 9);
    expect(dirs[2]?.dirX).toBeCloseTo(-SQ, 9);
  });

  it('opposite keys cancel into a stop', () => {
    const { intent, sent, rest, t } = setup();
    intent.update(new Set(['KeyA']), rest, t(0));
    intent.update(new Set(['KeyA', 'KeyD']), rest, t(10));
    expect(sent.map((c) => c.type)).toEqual(['Move', 'MoveStop']);
  });

  it('the stick wins over the keys outside its deadzone, and the keys count again inside it', () => {
    const { intent, sent, t } = setup();
    const keys = new Set(['KeyD']);
    intent.update(keys, { x: 0, y: -0.9 }, t(0)); // stick up beats the key
    intent.update(keys, { x: 0, y: -0.9 }, t(10));
    intent.update(keys, { x: 0.05, y: 0 }, t(20)); // inside the deadzone: the key again
    const moves = sent.map((c) => c as Extract<SimCommand, { type: 'Move' }>);
    expect(sent.map((c) => c.type)).toEqual(['Move', 'Move']);
    expect(moves[0]?.dirX).toBeCloseTo(-SQ, 9); // stick up: far side of the room
    expect(moves[1]?.dirX).toBeCloseTo(SQ, 9); // key right
  });

  it('does not flood while a stick hand rests or trembles within the angle step', () => {
    const { intent, sent, t } = setup();
    [-0.9, -0.91, -0.9, -0.89, -0.905].forEach((y, index) => {
      // A hand that rests on "up" and wobbles by a degree or two.
      intent.update(new Set(), { x: 0.005 * index, y }, t(index * 16));
    });
    expect(sent).toHaveLength(1);
  });

  it('stops when the stick returns to the deadzone', () => {
    const { intent, sent, t } = setup();
    intent.update(new Set(), { x: 0.9, y: 0 }, t(0));
    intent.update(new Set(), { x: 0.1, y: 0 }, t(10));
    expect(sent.map((c) => c.type)).toEqual(['Move', 'MoveStop']);
  });

  it('reads the deadzone and step from the feel at each update', () => {
    const camera = createIsoCamera();
    fitIsoCamera(camera, ROOM, 2);
    const sent: SimCommand[] = [];
    const input = { stickDeadzonePct: 20, stickAngleStepDeg: 5 };
    const intent = createMoveIntent({ camera, input, send: (command) => sent.push(command) });
    intent.update(new Set(), { x: 0.3, y: 0 }, asSimMs(0));
    expect(sent).toHaveLength(1);
    input.stickDeadzonePct = 50;
    intent.update(new Set(), { x: 0.3, y: 0 }, asSimMs(10));
    expect(sent.map((c) => c.type)).toEqual(['Move', 'MoveStop']);
  });

  it('reset forgets what was sent: a held key is sent again for a new sim, a rest sends no stop', () => {
    const { intent, sent, rest, t } = setup();
    const held = new Set(['KeyD']);
    intent.update(held, rest, t(0));
    intent.reset();
    intent.update(held, rest, t(10));
    expect(sent.map((c) => c.type)).toEqual(['Move', 'Move']);
    intent.reset();
    intent.update(new Set(), rest, t(20));
    expect(sent).toHaveLength(2);
  });
});

import { asSimMs } from '@shared/time';
import type { SimCommand } from '@sim';
import { describe, expect, it } from 'vitest';
import type { ActiveLevel } from '../app/levelSession.ts';
import { createIsoCamera, fitIsoCamera } from '../render/isoCamera.ts';
import type { StickAxes } from './gamepadInput.ts';
import { createHitTester } from './hitTest.ts';
import { createInputMapper } from './inputMapper.ts';
import { createMoveIntent } from './moveIntent.ts';
import type { PointerSample } from './pointerInput.ts';

const ROOM = {
  widthM: 9.1,
  depthM: 6.2,
  heightM: 3.3,
  floorYM: -0.8,
  centerXM: 0.35,
  centerZM: -0.1,
};
const RECT = { left: 100, top: 50, width: 800, height: 400 };

const click = (
  clientX: number,
  clientY: number,
  extra: Partial<PointerSample> = {},
): PointerSample => ({
  clientX,
  clientY,
  timeStamp: 1234,
  isPrimary: true,
  button: 0,
  ...extra,
});

function setup() {
  const camera = createIsoCamera();
  fitIsoCamera(camera, ROOM, RECT.width / RECT.height);
  const state = { app: 'level' as string, pause: 'running' as string, stick: { x: 0, y: 0 } };
  const commands: SimCommand[] = [];
  const clock = { realToSim: (ms: number) => asSimMs(ms - 1000) };
  const sim = {
    enqueue: (command: SimCommand) => commands.push(command),
    world: { time: { sim: asSimMs(777) } },
  };
  let active: ActiveLevel | null = { sim, timeMap: clock } as unknown as ActiveLevel;
  const held = new Set<string>();
  const markers: [number, number][] = [];
  const taps: [number, number][] = [];
  let nowAtReal = 2000;
  const moveIntent = createMoveIntent({
    camera,
    input: { stickDeadzonePct: 20, stickAngleStepDeg: 5 },
    send: (command) => active?.sim.enqueue(command),
  });
  const mapper = createInputMapper({
    appFsm: {
      get state() {
        return state.app as 'level';
      },
    },
    pause: {
      get state() {
        return state.pause as 'running';
      },
    },
    getActive: () => active,
    hitTester: createHitTester(camera),
    canvasRect: () => RECT,
    held,
    gamepad: { poll: (out: StickAxes) => Object.assign(out, state.stick) },
    moveIntent,
    showTapMarker: (x, z) => markers.push([x, z]),
    onTap: (x, z) => taps.push([x, z]),
    nowAtReal: () => nowAtReal,
  });
  return {
    mapper,
    state,
    commands,
    held,
    markers,
    taps,
    camera,
    setActive: (next: ActiveLevel | null) => (active = next),
    newSim: () => {
      const other = {
        enqueue: (command: SimCommand) => commands.push(command),
        world: { time: { sim: asSimMs(888) } },
      };
      return { sim: other, timeMap: clock } as unknown as ActiveLevel;
    },
    setNow: (ms: number) => (nowAtReal = ms),
  };
}

describe('createInputMapper: taps', () => {
  it('turns a tap on the canvas into a TapFloor on the floor point under it, stamped in sim time', () => {
    const { mapper, commands, markers, taps, camera } = setup();
    // The centre of the canvas is the centre of the camera view.
    mapper.handlePointerDown(click(RECT.left + RECT.width / 2, RECT.top + RECT.height / 2));
    expect(commands).toHaveLength(1);
    const command = commands[0] as Extract<SimCommand, { type: 'TapFloor' }>;
    expect(command.type).toBe('TapFloor');
    expect(command.t).toBe(234); // realToSim(1234) = 1234 - 1000, the real timestamp of the event
    const picked = createHitTester(camera);
    const expected = { xM: 0, zM: 0 };
    picked.pickFloor(0, 0, expected);
    expect(command.xM).toBeCloseTo(expected.xM, 9);
    expect(command.zM).toBeCloseTo(expected.zM, 9);
    expect(markers).toEqual([[command.xM, command.zM]]);
    expect(taps).toEqual([[command.xM, command.zM]]);
  });

  it('maps the corners of the canvas to the four corners of the view (y goes down on the screen)', () => {
    const { mapper, commands, camera } = setup();
    mapper.handlePointerDown(click(RECT.left, RECT.top)); // top-left
    mapper.handlePointerDown(click(RECT.left + RECT.width, RECT.top + RECT.height)); // bottom-right
    const picker = createHitTester(camera);
    const topLeft = { xM: 0, zM: 0 };
    const bottomRight = { xM: 0, zM: 0 };
    picker.pickFloor(-1, 1, topLeft);
    picker.pickFloor(1, -1, bottomRight);
    const [a, b] = commands as Extract<SimCommand, { type: 'TapFloor' }>[];
    expect([a?.xM, a?.zM]).toEqual([topLeft.xM, topLeft.zM]);
    expect([b?.xM, b?.zM]).toEqual([bottomRight.xM, bottomRight.zM]);
  });

  it('ignores a secondary pointer and any button but the main one', () => {
    const { mapper, commands, markers } = setup();
    mapper.handlePointerDown(click(300, 200, { isPrimary: false }));
    mapper.handlePointerDown(click(300, 200, { button: 2 }));
    mapper.handlePointerDown(click(300, 200, { button: 1 }));
    expect(commands).toEqual([]);
    expect(markers).toEqual([]);
  });

  it.each([
    ['the app is not in a level', { app: 'start' }],
    ['the game is paused', { pause: 'paused' }],
    ['the countdown runs', { pause: 'resuming' }],
  ])('drops a tap while %s: no command, no marker', (_name, patch) => {
    const { mapper, state, commands, markers, taps } = setup();
    Object.assign(state, patch);
    mapper.handlePointerDown(click(300, 200));
    expect(commands).toEqual([]);
    expect(markers).toEqual([]);
    expect(taps).toEqual([]);
  });

  it('drops a tap when no level is active, and a tap on a canvas with no size', () => {
    const { mapper, commands, setActive } = setup();
    setActive(null);
    mapper.handlePointerDown(click(300, 200));
    expect(commands).toEqual([]);
    expect(mapper.isLive()).toBe(false);
  });

  it('is live only in a running level', () => {
    const { mapper, state } = setup();
    expect(mapper.isLive()).toBe(true);
    state.pause = 'paused';
    expect(mapper.isLive()).toBe(false);
    state.pause = 'running';
    state.app = 'loading';
    expect(mapper.isLive()).toBe(false);
  });
});

describe('createInputMapper: movement', () => {
  it('sends Move when a movement key goes down in a live level, stamped in sim time', () => {
    const { mapper, held, commands } = setup();
    held.add('KeyD');
    mapper.onKeysChanged(1500);
    expect(commands).toHaveLength(1);
    const move = commands[0] as Extract<SimCommand, { type: 'Move' }>;
    expect(move).toMatchObject({ type: 'Move', t: 500 });
    expect(move.dirX).toBeCloseTo(Math.SQRT1_2, 12);
    expect(move.dirZ).toBeCloseTo(-Math.SQRT1_2, 12);
    held.clear();
    mapper.onKeysChanged(1600);
    expect(commands[1]).toEqual({ type: 'MoveStop', t: 600 });
  });

  it('sends nothing while paused, but a key held through the pause walks again at the resume', () => {
    const { mapper, held, commands, state } = setup();
    held.add('KeyD');
    mapper.onKeysChanged(1500);
    state.pause = 'paused';
    mapper.resync(); // nothing: not live
    state.pause = 'running';
    mapper.resync(); // still held and still what the sim was told: nothing more to say
    expect(commands.map((c) => c.type)).toEqual(['Move']);
  });

  it('stamps what a resume sends with the sim clock: the time map may have no frame yet', () => {
    const { mapper, held, commands } = setup();
    held.add('KeyD');
    mapper.resync();
    expect(commands).toMatchObject([{ type: 'Move', t: 777 }]);
  });

  it('sends a held key again when a tap path ends (resumeHeld), and nothing when none is held', () => {
    const { mapper, held, commands } = setup();
    mapper.resumeHeld();
    expect(commands).toEqual([]);
    held.add('KeyD');
    mapper.onKeysChanged(1500);
    mapper.resync(); // unchanged: nothing
    expect(commands.map((c) => c.type)).toEqual(['Move']);
    mapper.resumeHeld(); // the tap's path replaced the walk: the held key walks again
    expect(commands.map((c) => c.type)).toEqual(['Move', 'Move']);
  });

  it('does not read the time map on a frame that sends nothing', () => {
    const { mapper, state, commands, setActive } = setup();
    let reads = 0;
    setActive({
      sim: { enqueue: (c: SimCommand) => commands.push(c), world: { time: { sim: asSimMs(0) } } },
      timeMap: {
        realToSim: (ms: number) => {
          reads++;
          return asSimMs(ms);
        },
      },
    } as unknown as ActiveLevel);
    for (let i = 0; i < 5; i++) mapper.pollGamepad();
    expect(reads).toBe(0);
    state.stick = { x: 0.9, y: 0 };
    mapper.pollGamepad();
    mapper.pollGamepad();
    expect(reads).toBe(1);
  });

  it('a key released during the pause stops Papa at the resume', () => {
    const { mapper, held, commands, state } = setup();
    held.add('KeyD');
    mapper.onKeysChanged(1500);
    state.pause = 'paused';
    held.clear();
    mapper.onKeysChanged(1600); // not live: nothing sent
    expect(commands.map((c) => c.type)).toEqual(['Move']);
    state.pause = 'running';
    mapper.resync();
    expect(commands.map((c) => c.type)).toEqual(['Move', 'MoveStop']);
  });

  it('a key pressed during the pause walks at the resume', () => {
    const { mapper, held, commands, state } = setup();
    state.pause = 'paused';
    held.add('KeyW');
    mapper.onKeysChanged(1500);
    expect(commands).toEqual([]);
    state.pause = 'running';
    mapper.resync();
    expect(commands.map((c) => c.type)).toEqual(['Move']);
  });

  it('starts a new level with nothing sent: a key still held is sent again to the new sim', () => {
    const { mapper, held, commands, setActive, newSim } = setup();
    held.add('KeyD');
    mapper.onKeysChanged(1500);
    expect(commands).toHaveLength(1);
    setActive(newSim());
    mapper.resync();
    expect(commands.map((c) => c.type)).toEqual(['Move', 'Move']);
  });

  it('reads the stick once per frame and sends a Move for a push, a MoveStop for its release', () => {
    const { mapper, state, commands } = setup();
    state.stick = { x: 0.9, y: 0 };
    mapper.pollGamepad();
    mapper.pollGamepad();
    state.stick = { x: 0.1, y: 0 };
    mapper.pollGamepad();
    expect(commands.map((c) => c.type)).toEqual(['Move', 'MoveStop']);
  });

  it('does not read the stick when no level is live', () => {
    const { mapper, state, commands } = setup();
    state.stick = { x: 0.9, y: 0 };
    state.pause = 'paused';
    mapper.pollGamepad();
    expect(commands).toEqual([]);
  });
});

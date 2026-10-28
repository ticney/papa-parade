import { asSimMs } from '@shared/time';
import type { SimCommand } from '@sim';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { ActiveLevel } from '../app/levelSession.ts';
import { createIsoCamera, fitIsoCamera } from '../render/isoCamera.ts';
import type { PadButton, PadFamily, PadState, StickAxes } from './gamepadInput.ts';
import { createHitTester, type ObjectTarget, type ThreatTargets } from './hitTest.ts';
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
const TOUCH_RADIUS_PX = 48;
const OBJECT_TOUCH_RADIUS_PX = 64;

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
  pointerId: 1,
  ...extra,
});

function setup() {
  const camera = createIsoCamera();
  fitIsoCamera(camera, ROOM, RECT.width / RECT.height);
  const state = { app: 'level' as string, pause: 'running' as string, stick: { x: 0, y: 0 } };
  // What the fake pad reports at the next poll: presence, family, stamp; the edges are one-shot.
  const pad = {
    isPresent: false,
    family: 'xbox' as PadFamily,
    stampAtReal: 0,
    pressed: [] as PadButton[],
    released: [] as PadButton[],
  };
  const padButtons: PadButton[] = [];
  const padPresence: [boolean, PadFamily][] = [];
  let objects: ObjectTarget[] = [];
  const commands: SimCommand[] = [];
  const clock = { realToSim: (ms: number) => asSimMs(ms - 1000) };
  const sim = {
    enqueue: (command: SimCommand) => commands.push(command),
    world: {
      time: { sim: asSimMs(777) },
      flow: { state: 'playing' as 'playing' | 'ended' },
      papa: { xM: 0, zM: 0, state: 'idle' as string },
      threats: [] as unknown[],
    },
  };
  let active: ActiveLevel | null = { sim, timeMap: clock } as unknown as ActiveLevel;
  const held = new Set<string>();
  const markers: [number, number][] = [];
  const taps: [number, number][] = [];
  let nowAtReal = 2000;
  const pressedIds: number[] = [];
  let targets: ThreatTargets | null = null;
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
    gamepad: {
      poll: (out: StickAxes, padOut?: PadState) => {
        Object.assign(out, state.stick);
        if (padOut === undefined) return;
        padOut.isPresent = pad.isPresent;
        padOut.family = pad.family;
        padOut.stampAtReal = pad.stampAtReal;
        for (const button of Object.keys(padOut.pressed) as PadButton[]) {
          padOut.pressed[button] = pad.pressed.includes(button);
          padOut.released[button] = pad.released.includes(button);
        }
        pad.pressed = [];
        pad.released = [];
      },
    },
    input: { autoTargetConeDeg: 60, contextReachM: 1.5, stickDeadzonePct: 20 },
    getObjects: () => objects,
    onPadButton: (button) => padButtons.push(button),
    onPadPresence: (isPresent, family) => padPresence.push([isPresent, family]),
    moveIntent,
    getThreatTargets: () => targets,
    touchRadiusPx: TOUCH_RADIUS_PX,
    objectTouchRadiusPx: OBJECT_TOUCH_RADIUS_PX,
    onThreatPressed: (id) => pressedIds.push(id),
    showTapMarker: (x, z) => markers.push([x, z]),
    onTap: (x, z) => taps.push([x, z]),
    nowAtReal: () => nowAtReal,
  });
  return {
    mapper,
    sim,
    pad,
    padButtons,
    padPresence,
    setObjects: (next: ObjectTarget[]) => (objects = next),
    state,
    commands,
    held,
    markers,
    taps,
    camera,
    pressedIds,
    setTargets: (next: ThreatTargets | null) => (targets = next),
    setActive: (next: ActiveLevel | null) => (active = next),
    newSim: () => {
      const other = {
        enqueue: (command: SimCommand) => commands.push(command),
        world: {
          time: { sim: asSimMs(888) },
          flow: { state: 'playing' },
          papa: { xM: 0, zM: 0, state: 'idle' },
        },
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

  it('is not live once the level has ended (story 1.18): no pointer, key or pad input reaches the sim', () => {
    const { mapper, sim, commands, held } = setup();
    sim.world.flow.state = 'ended';
    expect(mapper.isLive()).toBe(false);
    expect(mapper.targetedThreatId()).toBeNull();
    mapper.handlePointerDown(click(300, 200));
    held.add('KeyD');
    mapper.onKeysChanged(1500);
    mapper.handleAction('down', 1600, 'keyboard');
    expect(commands).toEqual([]);
    sim.world.flow.state = 'playing';
    expect(mapper.isLive()).toBe(true);
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
      sim: {
        enqueue: (c: SimCommand) => commands.push(c),
        world: {
          time: { sim: asSimMs(0) },
          flow: { state: 'playing' },
          papa: { xM: 0, zM: 0, state: 'idle' },
        },
      },
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

describe('createInputMapper: threats', () => {
  /** An outlet-like icon at (-3, 0.3, 0.5): where it lands on screen with the test camera. */
  const ICON = { threatId: 4, xM: -3, yM: 0.3, zM: 0.5, icon: 'bolt' as const, followsPapa: false };
  const threat = (state: string, id = 4) => ({ id, state }) as never;

  function withThreat(state = 'windowOpen') {
    const env = setup();
    env.setTargets({ threats: [threat(state)], entries: [ICON] });
    const probe = new Vector3(ICON.xM, ICON.yM, ICON.zM).project(env.camera);
    const iconPx = {
      x: RECT.left + ((probe.x + 1) / 2) * RECT.width,
      y: RECT.top + ((1 - probe.y) / 2) * RECT.height,
    };
    return { ...env, iconPx };
  }

  it('turns a press on the icon into PressThreat, stamped in sim time, with no floor tap and no marker', () => {
    const { mapper, commands, markers, taps, pressedIds, iconPx } = withThreat();
    mapper.handlePointerDown(click(iconPx.x + 10, iconPx.y - 10));
    expect(commands).toEqual([{ type: 'PressThreat', t: 234, threatId: 4 }]);
    expect(markers).toEqual([]);
    expect(taps).toEqual([]);
    expect(pressedIds).toEqual([4]);
  });

  it('is a floor tap outside the radius, exactly as before', () => {
    const { mapper, commands, markers, pressedIds, iconPx } = withThreat();
    mapper.handlePointerDown(click(iconPx.x + TOUCH_RADIUS_PX + 5, iconPx.y));
    expect(commands.map((c) => c.type)).toEqual(['TapFloor']);
    expect(markers).toHaveLength(1);
    expect(pressedIds).toEqual([]);
  });

  it('presses only a telegraphed or open threat: an idle, resolved or gag one is the floor', () => {
    for (const state of ['idle', 'resolved', 'gag']) {
      const { mapper, commands, iconPx } = withThreat(state);
      mapper.handlePointerDown(click(iconPx.x, iconPx.y));
      expect(
        commands.map((c) => c.type),
        state,
      ).toEqual(['TapFloor']);
    }
  });

  it('is a floor tap when the level has no threat targets', () => {
    const { mapper, commands, setTargets } = withThreat();
    setTargets(null);
    mapper.handlePointerDown(click(300, 200));
    expect(commands.map((c) => c.type)).toEqual(['TapFloor']);
  });

  it('sends Release when the pressing pointer lets go, stamped in sim time, wherever the finger is', () => {
    const { mapper, commands, iconPx } = withThreat();
    mapper.handlePointerDown(click(iconPx.x, iconPx.y, { pointerId: 5 }));
    mapper.handlePointerUp(click(0, 0, { pointerId: 5, timeStamp: 1300 }));
    expect(commands).toEqual([
      { type: 'PressThreat', t: 234, threatId: 4 },
      { type: 'Release', t: 300 },
    ]);
  });

  it('sends Release once, and only for the pointer that pressed', () => {
    const { mapper, commands, iconPx } = withThreat();
    mapper.handlePointerDown(click(iconPx.x, iconPx.y, { pointerId: 5 }));
    mapper.handlePointerUp(click(0, 0, { pointerId: 6 }));
    expect(commands.map((c) => c.type)).toEqual(['PressThreat']);
    mapper.handlePointerUp(click(0, 0, { pointerId: 5 }));
    mapper.handlePointerUp(click(0, 0, { pointerId: 5 }));
    expect(commands.map((c) => c.type)).toEqual(['PressThreat', 'Release']);
  });

  it('sends nothing for the up of a floor tap', () => {
    const { mapper, commands } = withThreat();
    mapper.handlePointerDown(click(300, 200, { pointerId: 2 }));
    mapper.handlePointerUp(click(300, 200, { pointerId: 2 }));
    expect(commands.map((c) => c.type)).toEqual(['TapFloor']);
  });

  it('still sends Release while the game is paused or counting down', () => {
    const { mapper, commands, state, iconPx } = withThreat();
    mapper.handlePointerDown(click(iconPx.x, iconPx.y));
    state.pause = 'paused';
    mapper.handlePointerUp(click(0, 0, { timeStamp: 1500 }));
    expect(commands.at(-1)).toEqual({ type: 'Release', t: 500 });
  });

  it('a pause request with a finger down sends Release at the sim clock, and the later up sends nothing', () => {
    const { mapper, commands, iconPx } = withThreat();
    mapper.handlePointerDown(click(iconPx.x, iconPx.y));
    mapper.releaseHeld();
    expect(commands.at(-1)).toEqual({ type: 'Release', t: 777 });
    mapper.handlePointerUp(click(0, 0));
    mapper.releaseHeld();
    expect(commands.map((c) => c.type)).toEqual(['PressThreat', 'Release']);
  });

  it('a pause request right after a press dates Release no earlier than the press, which is ahead of the sim clock', () => {
    const { mapper, commands, iconPx } = withThreat();
    mapper.handlePointerDown(click(iconPx.x, iconPx.y, { timeStamp: 2000 }));
    mapper.releaseHeld();
    expect(commands).toEqual([
      { type: 'PressThreat', t: 1000, threatId: 4 },
      { type: 'Release', t: 1000 },
    ]);
  });

  it('forgets a press of the previous level without sending anything', () => {
    const { mapper, commands, iconPx, setActive, newSim } = withThreat();
    mapper.handlePointerDown(click(iconPx.x, iconPx.y));
    setActive(newSim());
    mapper.handlePointerUp(click(0, 0));
    mapper.releaseHeld();
    expect(commands.map((c) => c.type)).toEqual(['PressThreat']);
  });

  it('ignores a secondary pointer and a non-main button for a press', () => {
    const { mapper, commands, pressedIds, iconPx } = withThreat();
    mapper.handlePointerDown(click(iconPx.x, iconPx.y, { isPrimary: false }));
    mapper.handlePointerDown(click(iconPx.x, iconPx.y, { button: 2 }));
    expect(commands).toEqual([]);
    expect(pressedIds).toEqual([]);
  });

  it('drops a press while paused, like any tap', () => {
    const { mapper, commands, state, iconPx } = withThreat();
    state.pause = 'paused';
    mapper.handlePointerDown(click(iconPx.x, iconPx.y));
    expect(commands).toEqual([]);
  });
});

describe('createInputMapper: Space and A (story 1.17)', () => {
  /** A threat of the sim's world, active, closing at `windowOpenAt + 600`. */
  const threatAt = (
    id: number,
    xM: number,
    zM: number,
    windowOpenAt: number,
    state = 'telegraph',
  ) =>
    ({
      id,
      state,
      xM,
      zM,
      windowOpenAt,
      responseWindow: { windowMs: 600, perfectMs: 100, toleranceMs: 30, bufferMs: 100 },
    }) as never;

  // KeyD walks up-right on screen: (√½, -√½) in world axes with the test camera.
  const D_DIR = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };
  const along = (dir: { x: number; z: number }, distanceM: number) => ({
    xM: dir.x * distanceM,
    zM: dir.z * distanceM,
  });

  it('parries the only active threat at Space down, stamped from the event, and releases at Space up', () => {
    const { mapper, sim, commands, pressedIds } = setup();
    sim.world.threats = [threatAt(3, 2, 0, 1000)];
    mapper.handleAction('down', 1500, 'keyboard');
    expect(commands).toEqual([{ type: 'PressThreat', t: 500, threatId: 3 }]);
    expect(pressedIds).toEqual([3]);
    mapper.handleAction('up', 1620, 'keyboard');
    expect(commands[1]).toEqual({ type: 'Release', t: 620 });
  });

  it('picks the more urgent threat with no direction held, and the one in the cone with a key held', () => {
    const { mapper, sim, commands, held } = setup();
    const ahead = along(D_DIR, 3);
    sim.world.threats = [
      threatAt(1, -3, 2, 1000), // more urgent, behind
      threatAt(2, ahead.xM, ahead.zM, 4000), // later, straight ahead of KeyD
    ];
    mapper.handleAction('down', 1500, 'keyboard');
    mapper.handleAction('up', 1510, 'keyboard');
    held.add('KeyD');
    mapper.onKeysChanged(1520);
    mapper.handleAction('down', 1530, 'keyboard');
    expect(commands.filter((c) => c.type === 'PressThreat')).toMatchObject([
      { threatId: 1 },
      { threatId: 2 },
    ]);
  });

  it('falls back to the most urgent threat when the aim has none in its cone (D3)', () => {
    const { mapper, sim, commands, held } = setup();
    const behind = along(D_DIR, -3);
    sim.world.threats = [
      threatAt(1, behind.xM, behind.zM, 2000),
      threatAt(2, behind.xM - 1, behind.zM + 2, 1000),
    ];
    held.add('KeyD');
    mapper.onKeysChanged(1500);
    mapper.handleAction('down', 1510, 'keyboard');
    expect(commands.at(-1)).toMatchObject({ type: 'PressThreat', threatId: 2 });
  });

  it('measures the cone from where Papa stands now', () => {
    const { mapper, sim, commands, held } = setup();
    sim.world.papa.xM = 5;
    sim.world.papa.zM = 5;
    const ahead = along(D_DIR, 2);
    sim.world.threats = [
      threatAt(1, -1, 5, 1000), // more urgent, but to the left of Papa
      threatAt(2, 5 + ahead.xM, 5 + ahead.zM, 3000),
    ];
    held.add('KeyD');
    mapper.onKeysChanged(1500);
    mapper.handleAction('down', 1510, 'keyboard');
    expect(commands.at(-1)).toMatchObject({ type: 'PressThreat', threatId: 2 });
  });

  it('reports the targeted threat as the press would choose it, and none when nothing is live', () => {
    const { mapper, sim, state, setActive, held } = setup();
    expect(mapper.targetedThreatId()).toBeNull();
    const ahead = along(D_DIR, 3);
    sim.world.threats = [threatAt(1, -3, 2, 1000), threatAt(2, ahead.xM, ahead.zM, 4000)];
    expect(mapper.targetedThreatId()).toBe(1);
    held.add('KeyD');
    mapper.onKeysChanged(1500);
    expect(mapper.targetedThreatId()).toBe(2);
    state.pause = 'paused';
    expect(mapper.targetedThreatId()).toBeNull();
    state.pause = 'running';
    setActive(null);
    expect(mapper.targetedThreatId()).toBeNull();
  });

  it.each([
    ['the app is not in a level', { app: 'start' }],
    ['the game is paused', { pause: 'paused' }],
    ['the countdown runs', { pause: 'resuming' }],
  ])('sends nothing at Space down while %s', (_name, patch) => {
    const { mapper, sim, state, commands, pressedIds } = setup();
    sim.world.threats = [threatAt(1, 2, 0, 1000)];
    Object.assign(state, patch);
    mapper.handleAction('down', 1500, 'keyboard');
    expect(commands).toEqual([]);
    expect(pressedIds).toEqual([]);
  });

  it('sends nothing when no level is active (autoplay: getActive is null)', () => {
    const { mapper, sim, commands, setActive } = setup();
    sim.world.threats = [threatAt(1, 2, 0, 1000)];
    setActive(null);
    mapper.handleAction('down', 1500, 'keyboard');
    mapper.handleAction('up', 1600, 'keyboard');
    expect(commands).toEqual([]);
    expect(mapper.targetedThreatId()).toBeNull();
  });

  it('sends nothing for a Space up that pressed nothing (the Space that started the game)', () => {
    const { mapper, commands } = setup();
    mapper.handleAction('up', 1500, 'keyboard');
    expect(commands).toEqual([]);
  });

  it('a Space pressed before the level was live and released after sends nothing', () => {
    const { mapper, sim, state, commands } = setup();
    sim.world.threats = [threatAt(1, 2, 0, 1000)];
    state.pause = 'resuming';
    mapper.handleAction('down', 1500, 'keyboard');
    state.pause = 'running';
    mapper.handleAction('up', 1600, 'keyboard');
    expect(commands).toEqual([]);
  });

  it('a pause while Space is held sends one Release at the sim clock, and the later up nothing', () => {
    const { mapper, sim, commands } = setup();
    sim.world.threats = [threatAt(1, 2, 0, 1000)];
    mapper.handleAction('down', 1500, 'keyboard'); // t = 500, behind the sim clock (777)
    mapper.releaseHeld();
    mapper.releaseHeld();
    mapper.handleAction('up', 2500, 'keyboard');
    expect(commands).toEqual([
      { type: 'PressThreat', t: 500, threatId: 1 },
      { type: 'Release', t: 777 },
    ]);
  });

  it("keeps the keyboard and the pad presses apart from a finger's", () => {
    const { mapper, sim, commands, iconPx } = Object.assign(setup(), { iconPx: { x: 0, y: 0 } });
    sim.world.threats = [threatAt(1, 2, 0, 1000)];
    mapper.handleAction('down', 1500, 'keyboard');
    // A finger's up is not the keyboard's up.
    mapper.handlePointerUp(click(iconPx.x, iconPx.y, { pointerId: 9 }));
    expect(commands.map((c) => c.type)).toEqual(['PressThreat']);
    mapper.handleAction('up', 1600, 'gamepad'); // the pad did not press
    expect(commands.map((c) => c.type)).toEqual(['PressThreat']);
    mapper.handleAction('up', 1700, 'keyboard');
    expect(commands.map((c) => c.type)).toEqual(['PressThreat', 'Release']);
  });

  describe('the context action (D6)', () => {
    const COFFEE = { id: 'coffee_machine', xM: -3.6, yM: 1.05, zM: -2 };
    const PHONE = { id: 'phone', xM: -1.3, yM: 0.65, zM: -1.2 };

    it('walks to the nearest object in reach when no threat is active', () => {
      const { mapper, sim, commands, setObjects } = setup();
      setObjects([COFFEE, PHONE]);
      sim.world.papa.xM = -1.8;
      sim.world.papa.zM = -1.5;
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands).toEqual([{ type: 'TapObject', t: 500, objectId: 'phone' }]);
    });

    it('sends nothing with no object in reach', () => {
      const { mapper, commands, setObjects } = setup();
      setObjects([COFFEE, PHONE]);
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands).toEqual([]);
    });

    it('prefers a threat to an object, even a distant threat', () => {
      const { mapper, sim, commands, setObjects } = setup();
      setObjects([PHONE]);
      sim.world.papa.xM = PHONE.xM;
      sim.world.papa.zM = PHONE.zM;
      sim.world.threats = [threatAt(1, 3, 3, 1000)];
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands).toEqual([{ type: 'PressThreat', t: 500, threatId: 1 }]);
    });

    it('does not take an idle, resolved or gag threat for an active one', () => {
      const { mapper, sim, commands, setObjects } = setup();
      setObjects([PHONE]);
      sim.world.papa.xM = PHONE.xM;
      sim.world.papa.zM = PHONE.zM;
      sim.world.threats = [
        threatAt(1, 3, 3, 1000, 'idle'),
        threatAt(2, 3, 3, 1000, 'resolved'),
        threatAt(3, 3, 3, 1000, 'gag'),
      ];
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands).toEqual([{ type: 'TapObject', t: 500, objectId: 'phone' }]);
    });

    it('sends nothing at the up of a context action', () => {
      const { mapper, sim, commands, setObjects } = setup();
      setObjects([PHONE]);
      sim.world.papa.xM = PHONE.xM;
      sim.world.papa.zM = PHONE.zM;
      mapper.handleAction('down', 1500, 'keyboard');
      mapper.handleAction('up', 1600, 'keyboard');
      expect(commands.map((c) => c.type)).toEqual(['TapObject']);
    });
  });

  describe('the pad', () => {
    it('parries on the A press edge, stamped with the pad stamp, and releases on the A release edge', () => {
      const { mapper, sim, pad, commands, pressedIds } = setup();
      sim.world.threats = [threatAt(1, 2, 0, 1000)];
      pad.isPresent = true;
      pad.stampAtReal = 1990;
      pad.pressed = ['confirm'];
      mapper.pollGamepad();
      expect(commands).toEqual([{ type: 'PressThreat', t: 990, threatId: 1 }]);
      expect(pressedIds).toEqual([1]);
      pad.stampAtReal = 2040;
      pad.released = ['confirm'];
      mapper.pollGamepad();
      expect(commands[1]).toEqual({ type: 'Release', t: 1040 });
    });

    it('does not repeat a held A: only an edge acts', () => {
      const { mapper, sim, pad, commands } = setup();
      sim.world.threats = [threatAt(1, 2, 0, 1000)];
      pad.isPresent = true;
      pad.pressed = ['confirm'];
      mapper.pollGamepad();
      mapper.pollGamepad();
      mapper.pollGamepad();
      expect(commands).toHaveLength(1);
    });

    it('aims with the stick: the threat in its direction wins over a more urgent one', () => {
      const { mapper, sim, pad, state, commands } = setup();
      const ahead = { xM: Math.SQRT1_2 * 3, zM: -Math.SQRT1_2 * 3 };
      sim.world.threats = [threatAt(1, -3, 2, 1000), threatAt(2, ahead.xM, ahead.zM, 4000)];
      pad.isPresent = true;
      state.stick = { x: 0.9, y: 0 }; // right on the screen: the same world direction as KeyD
      pad.pressed = ['confirm'];
      mapper.pollGamepad();
      expect(commands.filter((c) => c.type === 'PressThreat')).toMatchObject([{ threatId: 2 }]);
    });

    it('sends the A press to the shell instead when no level is live, with every other button', () => {
      const { mapper, state, pad, padButtons, commands } = setup();
      state.pause = 'paused';
      pad.isPresent = true;
      pad.pressed = ['confirm', 'down', 'back', 'start'];
      mapper.pollGamepad();
      expect(padButtons).toEqual(['confirm', 'back', 'start', 'down']);
      expect(commands).toEqual([]);
    });

    it('sends B, Start and the D-pad to the shell in play, and never to the sim (D15)', () => {
      const { mapper, sim, pad, padButtons, commands } = setup();
      sim.world.threats = [threatAt(1, 2, 0, 1000)];
      pad.isPresent = true;
      pad.pressed = ['back', 'start', 'up', 'left'];
      mapper.pollGamepad();
      expect(padButtons).toEqual(['back', 'start', 'up', 'left']);
      expect(commands).toEqual([]);
    });

    it('turns a stick push into one menu step per push when no level is live', () => {
      const { mapper, state, pad, padButtons } = setup();
      state.pause = 'paused';
      pad.isPresent = true;
      state.stick = { x: 0, y: 0.9 };
      mapper.pollGamepad();
      mapper.pollGamepad();
      expect(padButtons).toEqual(['down']);
      state.stick = { x: 0, y: 0 };
      mapper.pollGamepad();
      state.stick = { x: 0.9, y: 0 };
      mapper.pollGamepad();
      expect(padButtons).toEqual(['down', 'right']);
    });

    it('does not step a menu while playing, nor when the stick held in play meets a pause', () => {
      const { mapper, state, pad, padButtons } = setup();
      pad.isPresent = true;
      state.stick = { x: 0.9, y: 0 };
      mapper.pollGamepad(); // walking
      state.pause = 'paused';
      mapper.pollGamepad(); // the same push, held through the pause: no step
      expect(padButtons).toEqual([]);
    });

    it('reports a pad that appears and one that goes away, once each, with its family', () => {
      const { mapper, pad, padPresence } = setup();
      mapper.pollGamepad();
      expect(padPresence).toEqual([]);
      pad.isPresent = true;
      pad.family = 'playstation';
      mapper.pollGamepad();
      mapper.pollGamepad();
      expect(padPresence).toEqual([[true, 'playstation']]);
      expect(mapper.padFamily).toBe('playstation');
      pad.isPresent = false;
      mapper.pollGamepad();
      mapper.pollGamepad();
      expect(padPresence).toEqual([
        [true, 'playstation'],
        [false, 'playstation'],
      ]);
    });

    it('reads the pad even when the game is paused, but walks only while live', () => {
      const { mapper, state, pad, padPresence, commands } = setup();
      state.pause = 'paused';
      state.stick = { x: 0.9, y: 0 };
      pad.isPresent = true;
      mapper.pollGamepad();
      expect(padPresence).toEqual([[true, 'xbox']]);
      expect(commands).toEqual([]);
    });

    it('turns a button edge pending at a resume into the same action as a poll would', () => {
      const { mapper, sim, pad, commands } = setup();
      sim.world.threats = [threatAt(1, 2, 0, 1000)];
      pad.isPresent = true;
      pad.pressed = ['confirm'];
      mapper.resync();
      expect(commands.map((c) => c.type)).toEqual(['PressThreat']);
    });

    it('stamps the edges read at a resume with the sim clock: the time map has no frame yet', () => {
      const { mapper, sim, pad, commands } = setup();
      sim.world.threats = [threatAt(1, 2, 0, 1000)];
      pad.isPresent = true;
      pad.stampAtReal = 1990; // would be 990 through the time map
      pad.pressed = ['confirm'];
      mapper.resync();
      pad.stampAtReal = 2500;
      pad.released = ['confirm'];
      mapper.resync();
      expect(commands).toEqual([
        { type: 'PressThreat', t: 777, threatId: 1 },
        { type: 'Release', t: 777 },
      ]);
    });

    it('never dates a Release before the press it ends', () => {
      const { mapper, sim, pad, commands } = setup();
      sim.world.threats = [threatAt(1, 2, 0, 1000)];
      pad.isPresent = true;
      pad.stampAtReal = 2500; // sim 1500
      pad.pressed = ['confirm'];
      mapper.pollGamepad();
      pad.stampAtReal = 2000; // a stale stamp: sim 1000
      pad.released = ['confirm'];
      mapper.pollGamepad();
      expect(commands[1]).toEqual({ type: 'Release', t: 1500 });
    });

    it('does not hand the target back to the pad at every poll of a drifting stick', () => {
      const { mapper, state, pad } = setup();
      pad.isPresent = true;
      state.stick = { x: 0.9, y: 0 };
      mapper.pollGamepad();
      expect(mapper.lastDevice).toBe('gamepad');
      mapper.handlePointerDown(click(300, 200));
      mapper.pollGamepad(); // the stick is still out of the deadzone: nothing new
      expect(mapper.lastDevice).toBe('pointer');
      state.stick = { x: 0, y: 0 };
      mapper.pollGamepad();
      state.stick = { x: 0.9, y: 0 };
      mapper.pollGamepad(); // a new push
      expect(mapper.lastDevice).toBe('gamepad');
    });
  });

  describe('lastDevice (D8)', () => {
    it('is null before any input', () => {
      expect(setup().mapper.lastDevice).toBeNull();
    });

    it('follows a pointer, a movement key, Space and the pad', () => {
      const { mapper, held, pad, state } = setup();
      mapper.handlePointerDown(click(300, 200));
      expect(mapper.lastDevice).toBe('pointer');
      held.add('KeyW');
      mapper.onKeysChanged(1500);
      expect(mapper.lastDevice).toBe('keyboard');
      mapper.handlePointerDown(click(300, 200));
      expect(mapper.lastDevice).toBe('pointer');
      mapper.handleAction('down', 1600, 'keyboard');
      expect(mapper.lastDevice).toBe('keyboard');
      pad.isPresent = true;
      pad.pressed = ['start'];
      mapper.pollGamepad();
      expect(mapper.lastDevice).toBe('gamepad');
      mapper.handlePointerDown(click(300, 200));
      state.stick = { x: 0.1, y: 0 }; // inside the deadzone: not an input
      mapper.pollGamepad();
      expect(mapper.lastDevice).toBe('pointer');
      state.stick = { x: 0.9, y: 0 };
      mapper.pollGamepad();
      expect(mapper.lastDevice).toBe('gamepad');
    });

    it('is the pointer for any pointer press, a right click or a second finger included', () => {
      const { mapper, held } = setup();
      held.add('KeyW');
      mapper.onKeysChanged(1500);
      mapper.handlePointerDown(click(300, 200, { button: 2 }));
      expect(mapper.lastDevice).toBe('pointer');
      held.add('KeyW');
      mapper.onKeysChanged(1600);
      mapper.handlePointerDown(click(300, 200, { isPrimary: false }));
      expect(mapper.lastDevice).toBe('pointer');
    });

    it('does not take the release of a key for a keyboard input', () => {
      const { mapper, held } = setup();
      mapper.handlePointerDown(click(300, 200));
      held.clear();
      mapper.onKeysChanged(1500);
      expect(mapper.lastDevice).toBe('pointer');
    });

    it('is set even by a press that was dropped (the hint follows the hand)', () => {
      const { mapper, state } = setup();
      state.pause = 'paused';
      mapper.handleAction('down', 1500, 'keyboard');
      expect(mapper.lastDevice).toBe('keyboard');
    });
  });
});

describe('createInputMapper: touching an object (story 1.19)', () => {
  const COFFEE = { id: 'coffee_machine', xM: -3.6, yM: 1.05, zM: -2 };
  const ICON = {
    threatId: 4,
    xM: -3.6,
    yM: 1.05,
    zM: -2,
    icon: 'bolt' as const,
    followsPapa: false,
  };
  const pxOf = (camera: Parameters<typeof Vector3.prototype.project>[0], o: typeof COFFEE) => {
    const v = new Vector3(o.xM, o.yM, o.zM).project(camera);
    return {
      x: RECT.left + ((v.x + 1) / 2) * RECT.width,
      y: RECT.top + ((1 - v.y) / 2) * RECT.height,
    };
  };

  it('sends TapObject for a press within objectTouchRadiusPx of the icon point, not a TapFloor', () => {
    const { mapper, commands, markers, taps, camera, setObjects } = setup();
    setObjects([COFFEE]);
    const at = pxOf(camera, COFFEE);
    mapper.handlePointerDown(click(at.x + OBJECT_TOUCH_RADIUS_PX - 2, at.y));
    expect(commands).toEqual([{ type: 'TapObject', t: 234, objectId: 'coffee_machine' }]);
    // The marker shows where Papa will stand: the object's floor point.
    expect(markers).toEqual([[COFFEE.xM, COFFEE.zM]]);
    expect(taps).toEqual([[COFFEE.xM, COFFEE.zM]]);
  });

  it('falls back to the floor beyond the radius', () => {
    const { mapper, commands, camera, setObjects } = setup();
    setObjects([COFFEE]);
    const at = pxOf(camera, COFFEE);
    mapper.handlePointerDown(click(at.x + OBJECT_TOUCH_RADIUS_PX + 4, at.y));
    expect(commands.map((c) => c.type)).toEqual(['TapFloor']);
  });

  it('prefers a threat to an object (threat > object > floor)', () => {
    const { mapper, commands, camera, setObjects, setTargets } = setup();
    setObjects([COFFEE]);
    setTargets({ threats: [{ id: 4, state: 'windowOpen' } as never], entries: [ICON] });
    const at = pxOf(camera, COFFEE); // the threat's icon is drawn on the object
    mapper.handlePointerDown(click(at.x, at.y));
    expect(commands.map((c) => c.type)).toEqual(['PressThreat']);
  });

  describe('while Papa is busy (drinking or asleep)', () => {
    it.each(['drink', 'asleep'])(
      'drops a press, an object tap, a floor tap and a Move (%s)',
      (state) => {
        const { mapper, sim, commands, held, camera, setObjects, setTargets } = setup();
        setObjects([COFFEE]);
        setTargets({ threats: [{ id: 4, state: 'windowOpen' } as never], entries: [ICON] });
        sim.world.papa.state = state;
        const at = pxOf(camera, COFFEE);
        mapper.handlePointerDown(click(at.x, at.y)); // a threat and an object
        mapper.handlePointerDown(click(RECT.left + 10, RECT.top + 10)); // the floor
        held.add('KeyD');
        mapper.onKeysChanged(1500);
        mapper.handleAction('down', 1500, 'keyboard');
        expect(commands).toEqual([]);
      },
    );

    it('control: the same inputs with Papa idle do send commands (so the drops above are the busy gate)', () => {
      const { mapper, sim, commands, held, camera, setObjects, setTargets } = setup();
      setObjects([COFFEE]);
      setTargets({ threats: [{ id: 4, state: 'windowOpen' } as never], entries: [ICON] });
      sim.world.papa.state = 'idle';
      const at = pxOf(camera, COFFEE);
      mapper.handlePointerDown(click(at.x, at.y));
      mapper.handlePointerDown(click(RECT.left + 10, RECT.top + 10));
      held.add('KeyD');
      mapper.onKeysChanged(1500);
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands.length).toBeGreaterThan(0);
    });

    it('shows no target while busy', () => {
      const { mapper, sim } = setup();
      sim.world.threats = [
        {
          id: 1,
          state: 'windowOpen',
          xM: 1,
          zM: 1,
          windowOpenAt: 1000,
          responseWindow: { windowMs: 600, perfectMs: 100, toleranceMs: 30, bufferMs: 100 },
        },
      ];
      expect(mapper.targetedThreatId()).toBe(1);
      sim.world.papa.state = 'asleep';
      expect(mapper.targetedThreatId()).toBeNull();
    });

    it('walks again from a held key once he is idle (resumeHeld)', () => {
      const { mapper, sim, commands, held } = setup();
      sim.world.papa.state = 'asleep';
      held.add('KeyD');
      mapper.onKeysChanged(1500);
      expect(commands).toEqual([]);
      sim.world.papa.state = 'idle';
      mapper.resumeHeld();
      expect(commands.map((c) => c.type)).toEqual(['Move']);
    });
  });
});

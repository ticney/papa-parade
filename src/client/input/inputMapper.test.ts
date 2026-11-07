import { asSimMs } from '@shared/time';
import type { SimCommand } from '@sim';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { ActiveLevel } from '../app/levelSession.ts';
import { createIsoCamera, fitIsoCamera } from '../render/isoCamera.ts';
import { BABY_CARRIED_FORWARD_M, BABY_CARRIED_HEIGHT_M } from '../render/views/babyView.ts';
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
const BABY_RADIUS_M = 0.2;

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
    // The level's stations (story 9.4), index-aligned with `world.chores`: none unless a test sets some.
    chores: [] as { objectId: string }[],
    world: {
      chores: [] as { state: string }[],
      time: { sim: asSimMs(777) },
      flow: { state: 'playing' as 'playing' | 'ended' | 'sequence' | 'finalRush' },
      sequence: {
        beat: { isRunning: false },
        duel: { isRunning: false },
        stealth: { isRunning: false },
      },
      papa: { xM: 0, zM: 0, state: 'idle' as string },
      // Far from the first tests' taps and from Papa: the baby only matters in the tests about him.
      baby: { xM: 40, zM: 40 },
      threats: [] as unknown[],
      props: [] as {
        id: string;
        xM: number;
        yM: number;
        zM: number;
        isMess: boolean;
      }[],
    },
  };
  let active: ActiveLevel | null = { sim, timeMap: clock } as unknown as ActiveLevel;
  const held = new Set<string>();
  const markers: [number, number][] = [];
  const taps: [number, number][] = [];
  let nowAtReal = 2000;
  let visualOffsetMs = 0;
  let babySlide = { xM: 0, zM: 0 };
  const pressedIds: number[] = [];
  let targets: ThreatTargets | null = null;
  // The off-screen bubbles' pick (story 9.3): no bubble unless a test sets one.
  let bubblePick: (clientX: number, clientY: number) => number | null = () => null;
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
    stealth: { holdMinMs: 400 },
    getObjects: () => objects,
    onPadButton: (button) => padButtons.push(button),
    onPadPresence: (isPresent, family) => padPresence.push([isPresent, family]),
    moveIntent,
    getThreatTargets: () => targets,
    pickOffscreenBubble: (clientX, clientY) => bubblePick(clientX, clientY),
    touchRadiusPx: TOUCH_RADIUS_PX,
    objectTouchRadiusPx: OBJECT_TOUCH_RADIUS_PX,
    babyBodyRadiusM: BABY_RADIUS_M,
    babyCarriedHeightM: BABY_CARRIED_HEIGHT_M,
    babyCarriedForwardM: BABY_CARRIED_FORWARD_M,
    getBabySlideM: () => babySlide,
    onThreatPressed: (id) => pressedIds.push(id),
    showTapMarker: (x, z) => markers.push([x, z]),
    onTap: (x, z) => taps.push([x, z]),
    nowAtReal: () => nowAtReal,
    visualOffsetMs: () => visualOffsetMs,
  });
  return {
    mapper,
    sim,
    pad,
    padButtons,
    padPresence,
    setObjects: (next: ObjectTarget[]) => (objects = next),
    setBabySlide: (xM: number, zM: number) => {
      babySlide = { xM, zM };
    },
    state,
    commands,
    held,
    markers,
    taps,
    camera,
    pressedIds,
    setTargets: (next: ThreatTargets | null) => (targets = next),
    setBubblePick: (next: (clientX: number, clientY: number) => number | null) =>
      (bubblePick = next),
    setActive: (next: ActiveLevel | null) => (active = next),
    newSim: () => {
      const other = {
        enqueue: (command: SimCommand) => commands.push(command),
        world: {
          time: { sim: asSimMs(888) },
          flow: { state: 'playing' },
          sequence: {
            beat: { isRunning: false },
            duel: { isRunning: false },
            stealth: { isRunning: false },
          },
          papa: { xM: 0, zM: 0, state: 'idle' },
          baby: { xM: 40, zM: 40 },
        },
      };
      return { sim: other, timeMap: clock } as unknown as ActiveLevel;
    },
    setNow: (ms: number) => (nowAtReal = ms),
    setOffset: (ms: number) => (visualOffsetMs = ms),
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
  const ICON = {
    threatId: 4,
    xM: -3,
    yM: 0.3,
    zM: 0.5,
    icon: 'bolt' as const,
    followsPapa: false,
    verb: '',
    iconShape: 'circle' as const,
    color: 'parry' as const,
    verbWidthPx: 0,
    verbHeightPx: 0,
    verbOffsetPx: 0,
  };
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

describe('createInputMapper: an off-screen bubble (story 9.3, D4, AC 5)', () => {
  const ICON = {
    threatId: 4,
    xM: -3,
    yM: 0.3,
    zM: 0.5,
    icon: 'bolt' as const,
    followsPapa: false,
    verb: '',
    iconShape: 'circle' as const,
    color: 'parry' as const,
    verbWidthPx: 0,
    verbHeightPx: 0,
    verbOffsetPx: 0,
  };
  /** A bubble for threat 9 around the page point (100, 100), 37 px across its radius. */
  const bubbleAt = (clientX: number, clientY: number): number | null =>
    Math.hypot(clientX - 100, clientY - 100) <= 37 ? 9 : null;

  function withBubble() {
    const env = setup();
    env.setTargets({
      threats: [{ id: 4, state: 'windowOpen' } as never, { id: 9, state: 'windowOpen' } as never],
      entries: [ICON, { ...ICON, threatId: 9, xM: 30, zM: 30 }],
    });
    env.setBubblePick(bubbleAt);
    return env;
  }

  it('turns a press on the bubble into the PressThreat of its threat, and its Release follows', () => {
    const { mapper, commands, markers, taps, pressedIds } = withBubble();
    mapper.handlePointerDown(click(110, 95, { pointerId: 3 }));
    mapper.handlePointerUp(click(600, 400, { pointerId: 3, timeStamp: 1300 }));
    expect(commands).toEqual([
      { type: 'PressThreat', t: 234, threatId: 9 },
      { type: 'Release', t: 300 },
    ]);
    expect(markers).toEqual([]);
    expect(taps).toEqual([]);
    expect(pressedIds).toEqual([9]);
  });

  it('wins over a world threat or the floor under it', () => {
    const { mapper, commands, camera, setBubblePick } = withBubble();
    const probe = new Vector3(ICON.xM, ICON.yM, ICON.zM).project(camera);
    const iconPx = {
      x: RECT.left + ((probe.x + 1) / 2) * RECT.width,
      y: RECT.top + ((1 - probe.y) / 2) * RECT.height,
    };
    // The bubble over the threat 4's icon: the bubble's threat is pressed.
    setBubblePick((x, y) => (Math.hypot(x - iconPx.x, y - iconPx.y) <= 37 ? 9 : null));
    mapper.handlePointerDown(click(iconPx.x, iconPx.y));
    expect(commands).toEqual([{ type: 'PressThreat', t: 234, threatId: 9 }]);
  });

  it('still sends the press when Papa is busy, to be refused by the sim, with no highlight mark', () => {
    const { mapper, sim, commands, pressedIds } = withBubble();
    sim.world.papa.state = 'drink';
    mapper.handlePointerDown(click(100, 100, { pointerId: 2 }));
    mapper.handlePointerUp(click(0, 0, { pointerId: 2, timeStamp: 1300 }));
    expect(commands).toEqual([
      { type: 'PressThreat', t: 234, threatId: 9 },
      { type: 'Release', t: 300 },
    ]);
    expect(pressedIds).toEqual([]);
  });

  it('is the usual tap off the bubble', () => {
    const { mapper, commands } = withBubble();
    mapper.handlePointerDown(click(RECT.left + 400, RECT.top + 300));
    expect(commands.map((c) => c.type)).toEqual(['TapFloor']);
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
    const COFFEE = {
      id: 'coffee_machine',
      kind: 'coffee_machine' as const,
      xM: -3.6,
      yM: 1.05,
      zM: -2,
    };
    const PHONE = { id: 'phone', kind: 'phone' as const, xM: -1.3, yM: 0.65, zM: -1.2 };

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
  const COFFEE = {
    id: 'coffee_machine',
    kind: 'coffee_machine' as const,
    xM: -3.6,
    yM: 1.05,
    zM: -2,
  };
  const ICON = {
    threatId: 4,
    xM: -3.6,
    yM: 1.05,
    zM: -2,
    icon: 'bolt' as const,
    followsPapa: false,
    verb: '',
    iconShape: 'circle' as const,
    color: 'parry' as const,
    verbWidthPx: 0,
    verbHeightPx: 0,
    verbOffsetPx: 0,
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

  describe('the baby (story 1.21)', () => {
    const BABY = { xM: -1, zM: 0.5 };
    const babyPx = (camera: Parameters<typeof Vector3.prototype.project>[0]) => {
      const v = new Vector3(BABY.xM, BABY_RADIUS_M, BABY.zM).project(camera);
      return {
        x: RECT.left + ((v.x + 1) / 2) * RECT.width,
        y: RECT.top + ((1 - v.y) / 2) * RECT.height,
      };
    };

    it('sends TapBaby for a press within objectTouchRadiusPx of his centre, marking his floor point', () => {
      const { mapper, sim, commands, markers, taps, camera } = setup();
      Object.assign(sim.world.baby, BABY);
      const at = babyPx(camera);
      mapper.handlePointerDown(click(at.x + OBJECT_TOUCH_RADIUS_PX - 2, at.y));
      expect(commands).toEqual([{ type: 'TapBaby', t: 234 }]);
      expect(markers).toEqual([[BABY.xM, BABY.zM]]);
      expect(taps).toEqual([[BABY.xM, BABY.zM]]);
    });

    it('takes the nearer of the baby and an object, a tie going to the baby (a baby crawling past a ringing phone never swallows the tap)', () => {
      const { mapper, sim, commands, camera, setObjects } = setup();
      Object.assign(sim.world.baby, BABY);
      const at = babyPx(camera);
      const phone = {
        id: 'phone',
        kind: 'phone' as const,
        xM: BABY.xM + 0.5,
        yM: BABY_RADIUS_M,
        zM: BABY.zM,
      };
      setObjects([phone]);
      const phoneAt = new Vector3(phone.xM, phone.yM, phone.zM).project(camera);
      const phonePx = {
        x: RECT.left + ((phoneAt.x + 1) / 2) * RECT.width,
        y: RECT.top + ((1 - phoneAt.y) / 2) * RECT.height,
      };
      // On the phone's icon: the phone, though the baby is in range too.
      mapper.handlePointerDown(click(phonePx.x, phonePx.y));
      expect(commands.map((c) => c.type)).toEqual(['TapObject']);
      commands.length = 0;
      // On the baby's centre: the baby, though the phone is in range too.
      mapper.handlePointerDown(click(at.x, at.y));
      expect(commands.map((c) => c.type)).toEqual(['TapBaby']);
    });

    it('prefers a threat to the baby, and the baby to an object (threat > baby > object > floor)', () => {
      const { mapper, sim, commands, camera, setObjects, setTargets } = setup();
      Object.assign(sim.world.baby, BABY);
      const at = babyPx(camera);
      // An object whose icon is on the baby.
      setObjects([
        { id: 'phone', kind: 'phone' as const, xM: BABY.xM, yM: BABY_RADIUS_M, zM: BABY.zM },
      ]);
      mapper.handlePointerDown(click(at.x, at.y));
      expect(commands.map((c) => c.type)).toEqual(['TapBaby']);
      commands.length = 0;
      setTargets({
        threats: [{ id: 4, state: 'windowOpen' } as never],
        entries: [{ ...ICON, xM: BABY.xM, yM: BABY_RADIUS_M, zM: BABY.zM }],
      });
      mapper.handlePointerDown(click(at.x, at.y));
      expect(commands.map((c) => c.type)).toEqual(['PressThreat']);
    });

    it('falls back to the floor beyond the radius', () => {
      const { mapper, sim, commands, camera } = setup();
      Object.assign(sim.world.baby, BABY);
      const at = babyPx(camera);
      mapper.handlePointerDown(click(at.x + OBJECT_TOUCH_RADIUS_PX + 4, at.y));
      expect(commands.map((c) => c.type)).toEqual(['TapFloor']);
    });

    it('is dropped while Papa is busy, like every other tap', () => {
      const { mapper, sim, commands, camera } = setup();
      Object.assign(sim.world.baby, BABY);
      sim.world.papa.state = 'onPhone';
      const at = babyPx(camera);
      mapper.handlePointerDown(click(at.x, at.y));
      expect(commands).toEqual([]);
    });

    it('Space / A with the baby in reach and no threat sends TapBaby', () => {
      const { mapper, sim, commands } = setup();
      Object.assign(sim.world.baby, { xM: 0.5, zM: 0.5 });
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands).toEqual([{ type: 'TapBaby', t: 500 }]);
    });

    it('Space / A takes the nearer of the baby and the object, a tie going to the baby', () => {
      const { mapper, sim, commands, setObjects } = setup();
      const phone = { id: 'phone', kind: 'phone' as const, xM: 1, yM: 0.65, zM: 0 };
      setObjects([phone]);
      Object.assign(sim.world.baby, { xM: 0.5, zM: 0 }); // nearer than the phone
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands.map((c) => c.type)).toEqual(['TapBaby']);
      commands.length = 0;
      Object.assign(sim.world.baby, { xM: 1.2, zM: 0 }); // farther than the phone
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands.map((c) => c.type)).toEqual(['TapObject']);
      commands.length = 0;
      Object.assign(sim.world.baby, { xM: 0, zM: 1 }); // as far as the phone: a tie
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands.map((c) => c.type)).toEqual(['TapBaby']);
    });

    describe('while he is carried (story 4.1)', () => {
      const pixelAt = (
        camera: Parameters<typeof Vector3.prototype.project>[0],
        yM: number,
        forwardM = 0,
      ) => {
        // `forwardM` along the gaze the tests give the baby: +x.
        const v = new Vector3(BABY.xM + forwardM, yM, BABY.zM).project(camera);
        return {
          x: RECT.left + ((v.x + 1) / 2) * RECT.width,
          y: RECT.top + ((1 - v.y) / 2) * RECT.height,
        };
      };

      /** A point `OBJECT_TOUCH_RADIUS_PX - 1` px from `from`, on the side away from `towards`. */
      const justInside = (from: { x: number; y: number }, towards: { x: number; y: number }) => {
        const length = Math.hypot(towards.x - from.x, towards.y - from.y);
        const reach = OBJECT_TOUCH_RADIUS_PX - 1;
        return {
          x: from.x - ((towards.x - from.x) / length) * reach,
          y: from.y - ((towards.y - from.y) / length) * reach,
        };
      };

      it('aims at the baby where he is drawn, lifted in Papa’s arms, not at his body on the floor', () => {
        const { mapper, sim, commands, camera } = setup();
        Object.assign(sim.world.baby, BABY, { state: 'carried', gazeX: 1, gazeZ: 0 });
        const lifted = pixelAt(camera, BABY_CARRIED_HEIGHT_M, BABY_CARRIED_FORWARD_M);
        const onFloor = pixelAt(camera, BABY_RADIUS_M);
        expect(lifted.y).not.toBeCloseTo(onFloor.y, 0);
        // Just inside the radius of the lifted point, and so beyond that of the floor point.
        const inside = justInside(lifted, onFloor);
        mapper.handlePointerDown(click(inside.x, inside.y));
        expect(commands).toEqual([{ type: 'TapBaby', t: 234 }]);
      });

      it('aims in front of Papa, where the carried baby is drawn, not at Papa’s own point', () => {
        const { mapper, sim, commands, camera } = setup();
        Object.assign(sim.world.baby, BABY, { state: 'carried', gazeX: 1, gazeZ: 0 });
        const drawn = pixelAt(camera, BABY_CARRIED_HEIGHT_M, BABY_CARRIED_FORWARD_M);
        const atPapa = pixelAt(camera, BABY_CARRIED_HEIGHT_M);
        expect(drawn.x).not.toBeCloseTo(atPapa.x, 0);
        // Just inside the radius of the drawn baby, on the side away from Papa's point: out of reach
        // of an aim that ignored the forward offset.
        const inside = justInside(drawn, atPapa);
        expect(Math.hypot(inside.x - atPapa.x, inside.y - atPapa.y)).toBeGreaterThan(
          OBJECT_TOUCH_RADIUS_PX,
        );
        mapper.handlePointerDown(click(inside.x, inside.y));
        expect(commands.map((c) => c.type)).toEqual(['TapBaby']);
      });

      it('still aims at his body on the floor when he is not carried', () => {
        const { mapper, sim, commands, camera } = setup();
        Object.assign(sim.world.baby, BABY, { state: 'babble' });
        const lifted = pixelAt(camera, BABY_CARRIED_HEIGHT_M);
        const onFloor = pixelAt(camera, BABY_RADIUS_M);
        const inside = justInside(onFloor, lifted);
        mapper.handlePointerDown(click(inside.x, inside.y));
        expect(commands.map((c) => c.type)).toEqual(['TapBaby']);
        // The other way round, a press next to the lifted point is only the floor.
        commands.length = 0;
        const beyond = justInside(lifted, onFloor);
        mapper.handlePointerDown(click(beyond.x, beyond.y));
        expect(commands.map((c) => c.type)).toEqual(['TapFloor']);
      });

      it('Space / A uses an object in reach before the baby, who is always in reach', () => {
        const { mapper, sim, commands, setObjects } = setup();
        Object.assign(sim.world.baby, { xM: 0, zM: 0, state: 'carried' });
        setObjects([{ id: 'phone', kind: 'phone' as const, xM: 1, yM: 0.65, zM: 0 }]);
        mapper.handleAction('down', 1500, 'keyboard');
        expect(commands.map((c) => c.type)).toEqual(['TapObject']);
      });

      it('Space / A puts him down when no object is in reach', () => {
        const { mapper, sim, commands, setObjects } = setup();
        Object.assign(sim.world.baby, { xM: 0, zM: 0, state: 'carried' });
        setObjects([{ id: 'phone', kind: 'phone' as const, xM: 5, yM: 0.65, zM: 0 }]);
        mapper.handleAction('down', 1500, 'keyboard');
        expect(commands).toEqual([{ type: 'TapBaby', t: 500 }]);
      });
    });

    it('Space / A sends nothing with the baby out of reach and no object', () => {
      const { mapper, commands } = setup();
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands).toEqual([]);
    });

    it('Space / A with a threat active still parries it, never the baby', () => {
      const { mapper, sim, commands } = setup();
      Object.assign(sim.world.baby, { xM: 0.5, zM: 0.5 });
      sim.world.threats = [
        {
          id: 1,
          state: 'telegraph',
          xM: 2,
          zM: 0,
          windowOpenAt: 1000,
          responseWindow: { windowMs: 600, perfectMs: 100, toleranceMs: 30, bufferMs: 100 },
        } as never,
      ];
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands.map((c) => c.type)).toEqual(['PressThreat']);
    });

    it('Space / A is dropped while Papa is busy', () => {
      const { mapper, sim, commands } = setup();
      Object.assign(sim.world.baby, { xM: 0.5, zM: 0.5 });
      sim.world.papa.state = 'drink';
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands).toEqual([]);
    });
  });

  describe('while Papa is busy (drinking, asleep or on the phone)', () => {
    it.each(['drink', 'asleep', 'onPhone', 'onToilet'])(
      'drops an object tap, a floor tap, a Move and an action with no threat up (%s)',
      (state) => {
        const { mapper, sim, commands, held, markers, camera, setObjects } = setup();
        setObjects([COFFEE]);
        sim.world.papa.state = state;
        const at = pxOf(camera, COFFEE);
        mapper.handlePointerDown(click(at.x, at.y)); // an object
        mapper.handlePointerDown(click(RECT.left + 10, RECT.top + 10)); // the floor
        held.add('KeyD');
        mapper.onKeysChanged(1500);
        mapper.handleAction('down', 1500, 'keyboard');
        expect(commands).toEqual([]);
        expect(markers).toEqual([]);
      },
    );

    it.each(['drink', 'asleep', 'onPhone', 'onToilet'])(
      'sends the PressThreat of a tap on a threat, without a marker or a highlight mark (%s, story 2.12)',
      (state) => {
        const { mapper, sim, commands, markers, taps, pressedIds, camera, setObjects, setTargets } =
          setup();
        setObjects([COFFEE]);
        setTargets({ threats: [{ id: 4, state: 'windowOpen' } as never], entries: [ICON] });
        sim.world.papa.state = state;
        const at = pxOf(camera, COFFEE);
        mapper.handlePointerDown(click(at.x, at.y));
        expect(commands).toEqual([{ type: 'PressThreat', t: 234, threatId: 4 }]);
        expect(markers).toEqual([]);
        expect(taps).toEqual([]);
        expect(pressedIds).toEqual([]);
      },
    );

    it('sends the Release of a busy press, so a refused tap never becomes a hold (D2)', () => {
      const { mapper, sim, commands, camera, setTargets } = setup();
      setTargets({ threats: [{ id: 4, state: 'windowOpen' } as never], entries: [ICON] });
      sim.world.papa.state = 'drink';
      const at = pxOf(camera, COFFEE);
      mapper.handlePointerDown(click(at.x, at.y, { pointerId: 7 }));
      mapper.handlePointerUp(click(0, 0, { pointerId: 7, timeStamp: 1300 }));
      expect(commands).toEqual([
        { type: 'PressThreat', t: 234, threatId: 4 },
        { type: 'Release', t: 300 },
      ]);
    });

    it('drops a tap on the floor while busy even with a threat up elsewhere', () => {
      const { mapper, sim, commands, markers, setTargets } = setup();
      setTargets({ threats: [{ id: 4, state: 'windowOpen' } as never], entries: [ICON] });
      sim.world.papa.state = 'onPhone';
      mapper.handlePointerDown(click(RECT.left + 10, RECT.top + 10));
      expect(commands).toEqual([]);
      expect(markers).toEqual([]);
    });

    it('Space / A with a threat up sends the PressThreat while busy, without a highlight mark', () => {
      const { mapper, sim, commands, pressedIds } = setup();
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
      sim.world.papa.state = 'drink';
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands.map((c) => c.type)).toEqual(['PressThreat']);
      expect(pressedIds).toEqual([]);
      mapper.handleAction('up', 1600, 'keyboard');
      expect(commands.map((c) => c.type)).toEqual(['PressThreat', 'Release']);
    });

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

  describe('while a special sequence holds Papa in place (story 4.4)', () => {
    const BABY = { xM: -1, zM: 0.5 };
    const babyPx = (camera: Parameters<typeof Vector3.prototype.project>[0]) => {
      const v = new Vector3(BABY.xM, BABY_RADIUS_M, BABY.zM).project(camera);
      return {
        x: RECT.left + ((v.x + 1) / 2) * RECT.width,
        y: RECT.top + ((1 - v.y) / 2) * RECT.height,
      };
    };
    const inSequence = (sim: ReturnType<typeof setup>['sim']) => {
      (sim.world.flow as { state: string }).state = 'sequence';
    };

    it('is live: the level is still going, so a press on a threat gets through', () => {
      const { mapper, sim, commands, camera, setObjects, setTargets } = setup();
      setObjects([COFFEE]);
      setTargets({ threats: [{ id: 4, state: 'windowOpen' } as never], entries: [ICON] });
      inSequence(sim);
      expect(mapper.isLive()).toBe(true);
      const at = pxOf(camera, COFFEE);
      mapper.handlePointerDown(click(at.x, at.y));
      expect(commands.map((c) => c.type)).toEqual(['PressThreat']);
    });

    it('is not live once the level has ended', () => {
      const { mapper, sim } = setup();
      (sim.world.flow as { state: string }).state = 'ended';
      expect(mapper.isLive()).toBe(false);
    });

    it('sends nothing for a tap on the floor, an object or the baby, and draws no tap marker', () => {
      const { mapper, sim, commands, markers, taps, camera, setObjects } = setup();
      setObjects([COFFEE]);
      Object.assign(sim.world.baby, BABY);
      inSequence(sim);
      const object = pxOf(camera, COFFEE);
      mapper.handlePointerDown(click(object.x, object.y));
      const baby = babyPx(camera);
      mapper.handlePointerDown(click(baby.x, baby.y));
      mapper.handlePointerDown(click(RECT.left + 10, RECT.top + 10));
      expect(commands).toEqual([]);
      expect(markers).toEqual([]);
      expect(taps).toEqual([]);
    });

    it('sends no Move and no MoveStop for a held key', () => {
      const { mapper, sim, commands, held } = setup();
      inSequence(sim);
      held.add('KeyD');
      mapper.onKeysChanged(1500);
      held.delete('KeyD');
      mapper.onKeysChanged(1600);
      expect(commands).toEqual([]);
    });

    it('Space with no threat up sends no TapBaby and no TapObject; on a threat it answers it', () => {
      const { mapper, sim, commands, setObjects } = setup();
      setObjects([COFFEE]);
      Object.assign(sim.world.baby, { xM: 0.2, zM: 0.2 });
      inSequence(sim);
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands).toEqual([]);
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
      mapper.handleAction('down', 1600, 'keyboard');
      expect(commands.map((c) => c.type)).toEqual(['PressThreat']);
    });

    it('a key held through the sequence walks again at its end (resumeHeld)', () => {
      const { mapper, sim, commands, held } = setup();
      inSequence(sim);
      held.add('KeyD');
      mapper.onKeysChanged(1500);
      expect(commands).toEqual([]);
      (sim.world.flow as { state: string }).state = 'playing';
      mapper.resumeHeld();
      expect(commands.map((c) => c.type)).toEqual(['Move']);
    });

    it('control: the same inputs outside a sequence do send commands', () => {
      const { mapper, commands, markers, held } = setup();
      mapper.handlePointerDown(click(RECT.left + 10, RECT.top + 10));
      held.add('KeyD');
      mapper.onKeysChanged(1500);
      expect(commands.map((c) => c.type)).toEqual(['TapFloor', 'Move']);
      expect(markers).toHaveLength(1);
    });
  });

  describe('while a beats step runs (story 4.5)', () => {
    const inBeats = (sim: ReturnType<typeof setup>['sim']) => {
      (sim.world.flow as { state: string }).state = 'sequence';
      sim.world.sequence.beat.isRunning = true;
    };

    it('a tap anywhere on the screen is a TapBeat, with no marker and no press to release', () => {
      const { mapper, sim, commands, markers, taps, camera, setObjects } = setup();
      setObjects([COFFEE]);
      inBeats(sim);
      const object = pxOf(camera, COFFEE);
      mapper.handlePointerDown(click(object.x, object.y));
      mapper.handlePointerDown(click(RECT.left + 10, RECT.top + 10));
      expect(commands.map((c) => c.type)).toEqual(['TapBeat', 'TapBeat']);
      expect(markers).toEqual([]);
      expect(taps).toEqual([]);
      mapper.handlePointerUp?.({
        pointerId: 1,
        isPrimary: true,
        button: 0,
        timeStamp: 1600,
      } as never);
      expect(commands.map((c) => c.type)).toEqual(['TapBeat', 'TapBeat']);
    });

    it('Space and the pad’s A are a TapBeat too, stamped like every input', () => {
      const { mapper, sim, commands } = setup();
      inBeats(sim);
      mapper.handleAction('down', 1500, 'keyboard');
      mapper.handleAction('down', 1700, 'gamepad');
      expect(commands.map((c) => c.type)).toEqual(['TapBeat', 'TapBeat']);
      const [first, second] = commands as { t: number }[];
      expect(second?.t).toBeGreaterThan(first?.t ?? Number.POSITIVE_INFINITY);
      // The release of a key ends nothing: no Release is sent for a beat.
      mapper.handleAction('up', 1550, 'keyboard');
      expect(commands.map((c) => c.type)).toEqual(['TapBeat', 'TapBeat']);
    });

    it('a threat still comes first: a press on one is a PressThreat, not a beat', () => {
      const { mapper, sim, commands, camera, setTargets } = setup();
      setTargets({ threats: [{ id: 4, state: 'windowOpen' } as never], entries: [ICON] });
      inBeats(sim);
      const icon = pxOf(camera, ICON as never);
      mapper.handlePointerDown(click(icon.x, icon.y));
      expect(commands.map((c) => c.type)).toEqual(['PressThreat']);
    });

    it('sends no Move for a held key, and a tap with the level over sends nothing', () => {
      const { mapper, sim, commands, held } = setup();
      inBeats(sim);
      held.add('KeyD');
      mapper.onKeysChanged(1500);
      expect(commands).toEqual([]);
      (sim.world.flow as { state: string }).state = 'ended';
      mapper.handleAction('down', 1600, 'keyboard');
      expect(commands).toEqual([]);
    });

    it('control: a sequence without a beats step still sends no tap', () => {
      const { mapper, sim, commands } = setup();
      (sim.world.flow as { state: string }).state = 'sequence';
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands).toEqual([]);
    });
  });

  describe('while a duel step runs (story 4.6)', () => {
    const WINDOW = { windowMs: 300, perfectMs: 100, toleranceMs: 60, bufferMs: 100 };
    const inDuel = (sim: ReturnType<typeof setup>['sim'], state: string | null = 'telegraph') => {
      (sim.world.flow as { state: string }).state = 'sequence';
      sim.world.sequence.duel.isRunning = true;
      sim.world.threats =
        state === null
          ? []
          : [{ id: 9, state, xM: 0, zM: 0, windowOpenAt: 5000, responseWindow: WINDOW }];
    };

    it('a finger anywhere on the screen is the press on the threat that is up, and its release follows', () => {
      const { mapper, sim, commands, markers, taps, pressedIds, setObjects } = setup();
      setObjects([COFFEE]);
      inDuel(sim);
      mapper.handlePointerDown(click(RECT.left + 10, RECT.top + 10));
      expect(commands).toEqual([{ type: 'PressThreat', t: 234, threatId: 9 }]);
      expect(pressedIds).toEqual([9]);
      expect(markers).toEqual([]);
      expect(taps).toEqual([]);
      mapper.handlePointerUp?.({
        pointerId: 1,
        isPrimary: true,
        button: 0,
        timeStamp: 1600,
      } as never);
      expect(commands.map((c) => c.type)).toEqual(['PressThreat', 'Release']);
    });

    it('presses the threat before its signal too: a duel of patience, the sim judges it early', () => {
      const { mapper, sim, commands } = setup();
      inDuel(sim, 'telegraph');
      mapper.handlePointerDown(click(RECT.left + 40, RECT.top + 40));
      expect(commands.map((c) => c.type)).toEqual(['PressThreat']);
    });

    it('is free in a rest: with no threat up a finger sends nothing', () => {
      const { mapper, sim, commands, markers, setObjects } = setup();
      setObjects([COFFEE]);
      inDuel(sim, null);
      mapper.handlePointerDown(click(RECT.left + 10, RECT.top + 10));
      mapper.handlePointerUp?.({
        pointerId: 1,
        isPrimary: true,
        button: 0,
        timeStamp: 1600,
      } as never);
      expect(commands).toEqual([]);
      expect(markers).toEqual([]);
    });

    it('Space reaches the threat, and its release ends it (the pad’s A shares its path)', () => {
      const { mapper, sim, commands } = setup();
      inDuel(sim, 'windowOpen');
      mapper.handleAction('down', 1500, 'keyboard');
      mapper.handleAction('up', 1550, 'keyboard');
      expect(commands.map((c) => c.type)).toEqual(['PressThreat', 'Release']);
    });

    it('a threat pick still comes first, and a duel sends no TapBeat', () => {
      const { mapper, sim, commands, camera, setTargets } = setup();
      setTargets({ threats: [{ id: 4, state: 'windowOpen' } as never], entries: [ICON] });
      inDuel(sim, 'windowOpen');
      const icon = pxOf(camera, ICON as never);
      mapper.handlePointerDown(click(icon.x, icon.y));
      mapper.handlePointerDown(click(RECT.left + 10, RECT.top + 10));
      expect(commands.map((c) => c.type)).toEqual(['PressThreat', 'PressThreat']);
      expect((commands[0] as { threatId: number }).threatId).toBe(4);
      expect((commands[1] as { threatId: number }).threatId).toBe(9);
    });

    it('control: a sequence that is not a duel sends no press from a finger', () => {
      const { mapper, sim, commands } = setup();
      inDuel(sim);
      sim.world.sequence.duel.isRunning = false;
      mapper.handlePointerDown(click(RECT.left + 10, RECT.top + 10));
      expect(commands).toEqual([]);
    });
  });
});

describe('createInputMapper: the stealth step (story 4.9)', () => {
  const WINDOW = { windowMs: 2000, perfectMs: 0, toleranceMs: 0, bufferMs: 0 };
  const COFFEE = {
    id: 'coffee_machine',
    kind: 'coffee_machine' as const,
    xM: -3.6,
    yM: 1.05,
    zM: -2,
  };
  const ICON = {
    threatId: 4,
    xM: -3,
    yM: 0.3,
    zM: 0.5,
    icon: 'bolt' as const,
    followsPapa: false,
    verb: '',
    iconShape: 'circle' as const,
    color: 'parry' as const,
    verbWidthPx: 0,
    verbHeightPx: 0,
    verbOffsetPx: 0,
  };
  const pxOf = (camera: Parameters<typeof Vector3.prototype.project>[0], o: typeof COFFEE) => {
    const v = new Vector3(o.xM, o.yM, o.zM).project(camera);
    return {
      x: RECT.left + ((v.x + 1) / 2) * RECT.width,
      y: RECT.top + ((1 - v.y) / 2) * RECT.height,
    };
  };
  const inStealth = (sim: ReturnType<typeof setup>['sim']) => {
    (sim.world.flow as { state: string }).state = 'sequence';
    sim.world.sequence.stealth.isRunning = true;
  };
  const up = (timeStamp: number, pointerId = 1) =>
    ({ pointerId, isPrimary: true, button: 0, timeStamp }) as never;
  const types = (commands: readonly SimCommand[]) => commands.map((c) => c.type);

  it('lets a floor tap through to a walk, with its marker (a sequence usually holds Papa)', () => {
    const { mapper, sim, commands, markers } = setup();
    inStealth(sim);
    mapper.handlePointerDown(click(RECT.left + RECT.width / 2, RECT.top + RECT.height / 2));
    expect(types(commands)).toEqual(['TapFloor']);
    expect(markers).toHaveLength(1);
  });

  it('control: any other sequence still holds the finger', () => {
    const { mapper, sim, commands, markers } = setup();
    (sim.world.flow as { state: string }).state = 'sequence';
    mapper.handlePointerDown(click(RECT.left + 10, RECT.top + 10));
    expect(commands).toEqual([]);
    expect(markers).toEqual([]);
  });

  it('sends Move for a held key, which a sequence usually refuses', () => {
    const { mapper, sim, commands, held } = setup();
    inStealth(sim);
    held.add('KeyD');
    mapper.onKeysChanged(1500);
    expect(types(commands)).toEqual(['Move']);
  });

  it('sends nothing and draws nothing for a tap on an object', () => {
    const { mapper, sim, commands, markers, taps, setObjects, camera } = setup();
    setObjects([COFFEE]);
    inStealth(sim);
    const at = pxOf(camera, COFFEE as never);
    mapper.handlePointerDown(click(at.x, at.y));
    expect(commands).toEqual([]);
    expect(markers).toEqual([]);
    expect(taps).toEqual([]);
  });

  it('sends only TapBaby for a tap on the baby, with no marker', () => {
    const { mapper, sim, commands, markers, taps, camera } = setup();
    inStealth(sim);
    sim.world.baby.xM = 0;
    sim.world.baby.zM = 0;
    const at = pxOf(camera, { xM: 0, zM: 0, yM: BABY_RADIUS_M } as never);
    mapper.handlePointerDown(click(at.x, at.y));
    expect(types(commands)).toEqual(['TapBaby']);
    expect(markers).toEqual([]);
    expect(taps).toEqual([]);
  });

  describe('the finger and the breath (D11)', () => {
    it('holds the breath once it is still down holdMinMs later, stamped press + holdMinMs, and lets go at its up', () => {
      const { mapper, sim, commands, setNow } = setup();
      inStealth(sim);
      mapper.handlePointerDown(click(RECT.left + 200, RECT.top + 200, { timeStamp: 1000 }));
      expect(types(commands)).toEqual(['TapFloor']);
      setNow(1200);
      mapper.pollGamepad();
      expect(types(commands)).toEqual(['TapFloor']);
      setNow(1450);
      mapper.pollGamepad();
      expect(commands[1]).toEqual({ type: 'HoldAnywhere', t: 400 });
      mapper.pollGamepad();
      expect(types(commands)).toEqual(['TapFloor', 'HoldAnywhere']);
      mapper.handlePointerUp(up(1900));
      expect(commands[2]).toEqual({ type: 'ReleaseHold', t: 900 });
    });

    it('a floor finger released before holdMinMs is a walk and no HoldAnywhere, and its up sends nothing', () => {
      const { mapper, sim, commands, setNow } = setup();
      inStealth(sim);
      mapper.handlePointerDown(click(RECT.left + 200, RECT.top + 200, { timeStamp: 1000 }));
      setNow(1100);
      mapper.pollGamepad();
      mapper.handlePointerUp(up(1100));
      setNow(2000);
      mapper.pollGamepad();
      expect(types(commands)).toEqual(['TapFloor']);
    });

    it('never holds for a finger on a threat: it is a press', () => {
      const { mapper, sim, commands, camera, setTargets, setNow } = setup();
      inStealth(sim);
      setTargets({ threats: [{ id: 4, state: 'windowOpen' } as never], entries: [ICON] });
      const icon = pxOf(camera, ICON as never);
      mapper.handlePointerDown(click(icon.x, icon.y, { timeStamp: 1000 }));
      setNow(3000);
      mapper.pollGamepad();
      expect(types(commands)).toEqual(['PressThreat']);
      mapper.handlePointerUp(up(3000));
      expect(types(commands)).toEqual(['PressThreat', 'Release']);
    });

    it('a pointercancel is an up: it lets the breath go too', () => {
      const { mapper, sim, commands, setNow } = setup();
      inStealth(sim);
      mapper.handlePointerDown(click(RECT.left + 200, RECT.top + 200, { timeStamp: 1000 }));
      setNow(1500);
      mapper.pollGamepad();
      mapper.handlePointerUp(up(1600));
      expect(types(commands)).toEqual(['TapFloor', 'HoldAnywhere', 'ReleaseHold']);
    });

    it('stamps the hold through the calibration offset like every other input', () => {
      const { mapper, sim, commands, setNow, setOffset } = setup();
      setOffset(50);
      inStealth(sim);
      mapper.handlePointerDown(click(RECT.left + 200, RECT.top + 200, { timeStamp: 1000 }));
      setNow(1500);
      mapper.pollGamepad();
      expect(commands[0]).toMatchObject({ type: 'TapFloor', t: -50 });
      expect(commands[1]).toEqual({ type: 'HoldAnywhere', t: 350 });
    });

    it('a finger still down when the step ends sends no breath at its up, held or not yet read', () => {
      for (const isHoldingAlready of [false, true]) {
        const { mapper, sim, commands, setNow } = setup();
        inStealth(sim);
        mapper.handlePointerDown(click(RECT.left + 200, RECT.top + 200, { timeStamp: 1000 }));
        if (isHoldingAlready) {
          setNow(1500);
          mapper.pollGamepad();
        }
        sim.world.sequence.stealth.isRunning = false;
        setNow(1600);
        mapper.pollGamepad();
        mapper.handlePointerUp(up(2000));
        const sent = types(commands);
        expect(sent).not.toContain('ReleaseHold');
        expect(sent.filter((type) => type === 'HoldAnywhere')).toHaveLength(
          isHoldingAlready ? 1 : 0,
        );
      }
    });

    it('forgets the holder when the step ends, so a chained step can take the breath again', () => {
      const { mapper, sim, commands, setNow } = setup();
      inStealth(sim);
      mapper.handlePointerDown(click(RECT.left + 200, RECT.top + 200, { timeStamp: 1000 }));
      setNow(1500);
      mapper.pollGamepad();
      sim.world.sequence.stealth.isRunning = false;
      mapper.pollGamepad();
      inStealth(sim);
      mapper.handleHold('down', 1700, 'keyboard');
      expect(types(commands)).toEqual(['TapFloor', 'HoldAnywhere', 'HoldAnywhere']);
    });

    it('sends nothing outside a stealth step', () => {
      const { mapper, commands, setNow } = setup();
      mapper.handlePointerDown(click(RECT.left + 200, RECT.top + 200, { timeStamp: 1000 }));
      setNow(2000);
      mapper.pollGamepad();
      mapper.handlePointerUp(up(2100));
      expect(types(commands)).toEqual(['TapFloor']);
    });

    it('a pause with the breath held lets it go at the sim clock, and the up after it sends nothing', () => {
      const { mapper, sim, commands, setNow } = setup();
      inStealth(sim);
      mapper.handlePointerDown(click(RECT.left + 200, RECT.top + 200, { timeStamp: 1000 }));
      setNow(1500);
      mapper.pollGamepad();
      mapper.releaseHeld();
      expect(commands[2]).toEqual({ type: 'ReleaseHold', t: 777 });
      mapper.handlePointerUp(up(2000));
      expect(types(commands)).toEqual(['TapFloor', 'HoldAnywhere', 'ReleaseHold']);
    });

    it('forgets the holder when a new level binds', () => {
      const { mapper, sim, commands, setNow, setActive, newSim } = setup();
      inStealth(sim);
      mapper.handlePointerDown(click(RECT.left + 200, RECT.top + 200, { timeStamp: 1000 }));
      setNow(1500);
      mapper.pollGamepad();
      const next = newSim();
      setActive(next);
      mapper.handlePointerUp(up(1800));
      expect(types(commands)).toEqual(['TapFloor', 'HoldAnywhere']);
    });
  });

  describe('E and the right trigger', () => {
    it('E holds on its down and lets go on its up, stamped from the event', () => {
      const { mapper, sim, commands } = setup();
      inStealth(sim);
      mapper.handleHold('down', 1500, 'keyboard');
      mapper.handleHold('up', 1700, 'keyboard');
      expect(commands).toEqual([
        { type: 'HoldAnywhere', t: 500 },
        { type: 'ReleaseHold', t: 700 },
      ]);
    });

    it('sends nothing outside a stealth step, and no ReleaseHold for a hold it never made', () => {
      const { mapper, sim, commands } = setup();
      mapper.handleHold('down', 1500, 'keyboard');
      mapper.handleHold('up', 1700, 'keyboard');
      inStealth(sim);
      mapper.handleHold('up', 1800, 'keyboard');
      expect(commands).toEqual([]);
    });

    it('is dropped while the game is paused, but its up is not', () => {
      const { mapper, sim, commands, state } = setup();
      inStealth(sim);
      mapper.handleHold('down', 1500, 'keyboard');
      state.pause = 'paused';
      mapper.handleHold('up', 1700, 'keyboard');
      mapper.handleHold('down', 1800, 'keyboard');
      expect(types(commands)).toEqual(['HoldAnywhere', 'ReleaseHold']);
    });

    it('the pad’s right trigger holds and lets go, and never reaches the menu', () => {
      const { mapper, sim, pad, commands, padButtons } = setup();
      inStealth(sim);
      pad.isPresent = true;
      pad.stampAtReal = 1500;
      pad.pressed = ['hold'];
      mapper.pollGamepad();
      pad.stampAtReal = 1700;
      pad.released = ['hold'];
      mapper.pollGamepad();
      expect(commands).toEqual([
        { type: 'HoldAnywhere', t: 500 },
        { type: 'ReleaseHold', t: 700 },
      ]);
      expect(padButtons).toEqual([]);
    });

    it('the trigger outside a stealth step, or outside play, moves no menu and sends nothing', () => {
      const { mapper, sim, pad, commands, padButtons, state } = setup();
      pad.isPresent = true;
      pad.pressed = ['hold'];
      mapper.pollGamepad();
      state.app = 'start';
      pad.pressed = ['hold'];
      pad.released = ['hold'];
      mapper.pollGamepad();
      expect(commands).toEqual([]);
      expect(padButtons).toEqual([]);
      expect(sim.world.sequence.stealth.isRunning).toBe(false);
    });

    it('one device at a time: a second hold is ignored and only the holder lets go', () => {
      const { mapper, sim, commands } = setup();
      inStealth(sim);
      mapper.handleHold('down', 1500, 'keyboard');
      mapper.handleHold('down', 1520, 'gamepad');
      mapper.handleHold('up', 1540, 'gamepad');
      mapper.handleHold('up', 1560, 'keyboard');
      expect(types(commands)).toEqual(['HoldAnywhere', 'ReleaseHold']);
    });

    it('never dates a release before its hold', () => {
      const { mapper, sim, commands } = setup();
      inStealth(sim);
      mapper.handleHold('down', 1500, 'keyboard');
      mapper.handleHold('up', 1400, 'keyboard');
      expect(commands[1]).toEqual({ type: 'ReleaseHold', t: 500 });
    });
  });

  describe('Space and A (D12)', () => {
    it('press the sigh too: pressing the action while only the false alarm is up is a press on it', () => {
      const { mapper, sim, commands, pressedIds } = setup();
      inStealth(sim);
      sim.world.threats = [
        { id: 6, state: 'windowOpen', xM: 0, zM: 0, windowOpenAt: 5000, responseWindow: WINDOW },
      ];
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands).toEqual([{ type: 'PressThreat', t: 500, threatId: 6 }]);
      expect(pressedIds).toEqual([6]);
    });

    it('with nothing up send nothing: never TapBaby or TapObject, even with the baby and an object in reach', () => {
      const { mapper, sim, commands, setObjects } = setup();
      setObjects([{ id: 'coffee', kind: 'coffee_machine', xM: 0.2, zM: 0, yM: 1 } as never]);
      inStealth(sim);
      sim.world.baby.xM = 0.3;
      sim.world.baby.zM = 0;
      mapper.handleAction('down', 1500, 'keyboard');
      mapper.handleAction('up', 1600, 'keyboard');
      expect(commands).toEqual([]);
    });
  });
});

describe('createInputMapper: the toilet (story 4.3)', () => {
  const TOILET = { id: 'toilet', kind: 'toilet' as const, xM: 1, yM: 1, zM: 0 };
  const COFFEE_FAR = {
    id: 'coffee_machine',
    kind: 'coffee_machine' as const,
    xM: -1.4,
    yM: 1.05,
    zM: 0,
  };
  const pxOfPoint = (
    camera: Parameters<typeof Vector3.prototype.project>[0],
    o: { xM: number; yM: number; zM: number },
  ) => {
    const v = new Vector3(o.xM, o.yM, o.zM).project(camera);
    return {
      x: RECT.left + ((v.x + 1) / 2) * RECT.width,
      y: RECT.top + ((1 - v.y) / 2) * RECT.height,
    };
  };

  describe('Space / A', () => {
    it('puts a carried baby down beside the door, and the second press goes in (two presses, always)', () => {
      const { mapper, sim, commands, setObjects } = setup();
      setObjects([TOILET]);
      Object.assign(sim.world.baby, { xM: 0, zM: 0, state: 'carried' });
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands).toEqual([{ type: 'TapBaby', t: 500 }]);
      commands.length = 0;
      // Put down 0.4 m ahead of Papa: nearer than the door, and free.
      Object.assign(sim.world.baby, { xM: 0.4, zM: 0, state: 'babble' });
      mapper.handleAction('down', 1600, 'keyboard');
      expect(commands).toEqual([{ type: 'TapObject', t: 600, objectId: 'toilet' }]);
    });

    it('lets a toilet in reach beat a free baby, whatever the distances', () => {
      for (const babyXM of [0.1, 0.5, 0.99, 1.4]) {
        const { mapper, sim, commands, setObjects } = setup();
        setObjects([TOILET]);
        Object.assign(sim.world.baby, { xM: babyXM, zM: 0, state: 'babble' });
        mapper.handleAction('down', 1500, 'keyboard');
        expect(commands, String(babyXM)).toEqual([
          { type: 'TapObject', t: 500, objectId: 'toilet' },
        ]);
      }
    });

    it('lets a toilet in reach beat a free baby even when a coffee machine is nearer than the door', () => {
      const { mapper, sim, commands, setObjects } = setup();
      // The coffee machine (0.6 m) is the nearest object, the door (1 m) is in reach too, and the
      // baby (0.3 m) is nearer than both: he must not win, or he is taken back as he is put down.
      setObjects([TOILET, { ...COFFEE_FAR, xM: -0.6 }]);
      Object.assign(sim.world.baby, { xM: 0.3, zM: 0, state: 'babble' });
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands).toEqual([{ type: 'TapObject', t: 500, objectId: 'coffee_machine' }]);
    });

    it('keeps the rule of the coffee machine and the phone: an object in reach beats a carried baby', () => {
      const { mapper, sim, commands, setObjects } = setup();
      setObjects([TOILET, COFFEE_FAR]);
      Object.assign(sim.world.baby, { xM: 0, zM: 0, state: 'carried' });
      // The toilet is nearer (1 m against 1.4 m) but is no object in reach with a baby in the arms.
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands).toEqual([{ type: 'TapObject', t: 500, objectId: 'coffee_machine' }]);
    });

    it('still takes a free baby beside a coffee machine, as before', () => {
      const { mapper, sim, commands, setObjects } = setup();
      setObjects([COFFEE_FAR]);
      Object.assign(sim.world.baby, { xM: -0.2, zM: 0, state: 'babble' });
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands).toEqual([{ type: 'TapBaby', t: 500 }]);
    });
  });

  describe('a tap on the door', () => {
    it('sends TapObject and shows the tap marker at its floor point when the baby is free', () => {
      const { mapper, sim, commands, markers, taps, camera, setObjects } = setup();
      setObjects([TOILET]);
      Object.assign(sim.world.baby, { xM: 40, zM: 40, state: 'babble' });
      const at = pxOfPoint(camera, TOILET);
      mapper.handlePointerDown(click(at.x, at.y));
      expect(commands).toEqual([{ type: 'TapObject', t: 234, objectId: 'toilet' }]);
      expect(markers).toEqual([[TOILET.xM, TOILET.zM]]);
      expect(taps).toEqual([[TOILET.xM, TOILET.zM]]);
    });

    it('sends the command but no tap marker while the baby is carried: Papa goes nowhere', () => {
      const { mapper, sim, commands, markers, taps, camera, setObjects } = setup();
      setObjects([TOILET]);
      Object.assign(sim.world.baby, { xM: 0, zM: 0, state: 'carried', gazeX: -1, gazeZ: 0 });
      const at = pxOfPoint(camera, TOILET);
      mapper.handlePointerDown(click(at.x, at.y));
      expect(commands).toEqual([{ type: 'TapObject', t: 234, objectId: 'toilet' }]);
      expect(markers).toEqual([]);
      expect(taps).toEqual([]);
    });
  });
});

describe('createInputMapper: a chore’s station (story 9.4)', () => {
  const STOVE = { id: 'stove', kind: 'stove' as const, xM: 1, yM: 1, zM: 0 };
  const COFFEE_NEAR = {
    id: 'coffee_machine',
    kind: 'coffee_machine' as const,
    xM: 0.5,
    yM: 1,
    zM: 0,
  };
  const pxOfPoint = (
    camera: Parameters<typeof Vector3.prototype.project>[0],
    o: { xM: number; yM: number; zM: number },
  ) => {
    const v = new Vector3(o.xM, o.yM, o.zM).project(camera);
    return {
      x: RECT.left + ((v.x + 1) / 2) * RECT.width,
      y: RECT.top + ((1 - v.y) / 2) * RECT.height,
    };
  };
  /** Papa works at the stove: the world says so, as the sim does. */
  function working(sim: ReturnType<typeof setup>['sim']): void {
    Object.assign(sim, { chores: [{ objectId: 'stove' }] });
    Object.assign(sim.world, { chores: [{ state: 'working' }] });
    sim.world.papa.state = 'chore';
  }

  it('sends TapObject and shows the tap marker where Papa will stand, when he is free', () => {
    const { mapper, sim, commands, markers, camera, setObjects } = setup();
    setObjects([STOVE]);
    Object.assign(sim, { chores: [{ objectId: 'stove' }] });
    Object.assign(sim.world, { chores: [{ state: 'untouched' }] });
    Object.assign(sim.world.baby, { xM: 40, zM: 40, state: 'babble' });
    const at = pxOfPoint(camera, STOVE);
    mapper.handlePointerDown(click(at.x, at.y));
    expect(commands).toEqual([{ type: 'TapObject', t: 234, objectId: 'stove' }]);
    expect(markers).toEqual([[STOVE.xM, STOVE.zM]]);
  });

  it('is still a TapObject while Papa works there, the beat’s press, but shows no marker and no tap', () => {
    const { mapper, sim, commands, markers, taps, camera, setObjects } = setup();
    setObjects([STOVE]);
    working(sim);
    Object.assign(sim.world.baby, { xM: 40, zM: 40, state: 'babble' });
    const at = pxOfPoint(camera, STOVE);
    mapper.handlePointerDown(click(at.x, at.y));
    expect(commands).toEqual([{ type: 'TapObject', t: 234, objectId: 'stove' }]);
    expect(markers).toEqual([]);
    expect(taps).toEqual([]);
  });

  it('sends the command but no marker while the baby is carried: the sim refuses it', () => {
    const { mapper, sim, commands, markers, taps, camera, setObjects } = setup();
    setObjects([STOVE]);
    Object.assign(sim.world.baby, { xM: 0, zM: 0, state: 'carried', gazeX: -1, gazeZ: 0 });
    const at = pxOfPoint(camera, STOVE);
    mapper.handlePointerDown(click(at.x, at.y));
    expect(commands).toEqual([{ type: 'TapObject', t: 234, objectId: 'stove' }]);
    expect(markers).toEqual([]);
    expect(taps).toEqual([]);
  });

  it('lets Space put a carried baby down beside the stove: the station is no object in reach then', () => {
    const { mapper, sim, commands, setObjects } = setup();
    setObjects([STOVE]);
    Object.assign(sim.world.baby, { xM: 0, zM: 0, state: 'carried' });
    mapper.handleAction('down', 1500, 'keyboard');
    expect(commands).toEqual([{ type: 'TapBaby', t: 500 }]);
  });

  it('still reaches another object past the stove while the baby is carried', () => {
    const { mapper, sim, commands, setObjects } = setup();
    setObjects([STOVE, COFFEE_NEAR]);
    Object.assign(sim.world.baby, { xM: 0, zM: 0, state: 'carried' });
    mapper.handleAction('down', 1500, 'keyboard');
    expect(commands).toEqual([{ type: 'TapObject', t: 500, objectId: 'coffee_machine' }]);
  });

  it('lets Space take a free baby beside a stove whose chore is done: a done station is inert', () => {
    const { mapper, sim, commands, setObjects } = setup();
    setObjects([STOVE]);
    Object.assign(sim, { chores: [{ objectId: 'stove' }] });
    Object.assign(sim.world, { chores: [{ state: 'done' }] });
    // Papa stands at the stove (distance 0 to it), the baby a metre away: the station used to win.
    Object.assign(sim.world.papa, { xM: STOVE.xM, zM: STOVE.zM });
    Object.assign(sim.world.baby, { xM: STOVE.xM + 1, zM: STOVE.zM, state: 'babble' });
    mapper.handleAction('down', 1500, 'keyboard');
    expect(commands).toEqual([{ type: 'TapBaby', t: 500 }]);
  });

  it('still lets Space reach a stove whose chore is not done, beside a free baby', () => {
    const { mapper, sim, commands, setObjects } = setup();
    setObjects([STOVE]);
    Object.assign(sim, { chores: [{ objectId: 'stove' }] });
    Object.assign(sim.world, { chores: [{ state: 'paused' }] });
    Object.assign(sim.world.papa, { xM: STOVE.xM, zM: STOVE.zM });
    Object.assign(sim.world.baby, { xM: STOVE.xM + 1, zM: STOVE.zM, state: 'babble' });
    mapper.handleAction('down', 1500, 'keyboard');
    expect(commands).toEqual([{ type: 'TapObject', t: 500, objectId: 'stove' }]);
  });

  it('sends Space near the stove as the beat’s press when the baby is free', () => {
    const { mapper, sim, commands, setObjects } = setup();
    setObjects([STOVE]);
    working(sim);
    Object.assign(sim.world.baby, { xM: 40, zM: 40, state: 'babble' });
    mapper.handleAction('down', 1500, 'keyboard');
    expect(commands).toEqual([{ type: 'TapObject', t: 500, objectId: 'stove' }]);
  });
});

describe('createInputMapper: tidying in the final rush (story 3.5)', () => {
  const MUG = { id: 'mug_01', xM: 0.8, yM: 0.05, zM: 0.2, isMess: true };
  const BOOK = { id: 'book_01', xM: 3.4, yM: 0.02, zM: -0.5, isMess: true };
  const PHONE = { id: 'phone', kind: 'phone' as const, xM: 0.3, yM: 0.65, zM: 0 };
  const pxOfPoint = (
    camera: Parameters<typeof Vector3.prototype.project>[0],
    o: { xM: number; yM: number; zM: number },
  ) => {
    const v = new Vector3(o.xM, o.yM, o.zM).project(camera);
    return {
      x: RECT.left + ((v.x + 1) / 2) * RECT.width,
      y: RECT.top + ((1 - v.y) / 2) * RECT.height,
    };
  };

  /** A threat of the sim's world, active, closing at `windowOpenAt + 600`. */
  const threatAt = (id: number, xM: number, zM: number, windowOpenAt: number) =>
    ({
      id,
      state: 'telegraph',
      xM,
      zM,
      windowOpenAt,
      responseWindow: { windowMs: 600, perfectMs: 100, toleranceMs: 30, bufferMs: 100 },
    }) as never;

  function rush(props = [MUG, BOOK]) {
    const harness = setup();
    harness.sim.world.flow.state = 'finalRush';
    harness.sim.world.props.push(...props.map((prop) => ({ ...prop })));
    return harness;
  }

  describe('a tap', () => {
    it('sends TapObject for a prop that is a mess, with the marker at its floor point', () => {
      const { mapper, commands, markers, taps, camera } = rush();
      const at = pxOfPoint(camera, MUG);
      mapper.handlePointerDown(click(at.x, at.y + OBJECT_TOUCH_RADIUS_PX - 2));
      expect(commands).toEqual([{ type: 'TapObject', t: 234, objectId: 'mug_01' }]);
      expect(markers).toEqual([[MUG.xM, MUG.zM]]);
      expect(taps).toEqual([[MUG.xM, MUG.zM]]);
    });

    it('does not see a prop that is no mess, or any prop outside the rush: the finger walks to the floor', () => {
      const flat = rush([{ ...MUG, isMess: false }]);
      const at = pxOfPoint(flat.camera, MUG);
      flat.mapper.handlePointerDown(click(at.x, at.y));
      expect(flat.commands.map((c) => c.type)).toEqual(['TapFloor']);
      const outside = rush();
      outside.sim.world.flow.state = 'playing';
      const there = pxOfPoint(outside.camera, MUG);
      outside.mapper.handlePointerDown(click(there.x, there.y));
      expect(outside.commands.map((c) => c.type)).toEqual(['TapFloor']);
    });

    it('goes to the nearer to the finger of a prop and an object', () => {
      const { mapper, commands, camera, setObjects } = rush();
      setObjects([PHONE]);
      const mug = pxOfPoint(camera, MUG);
      const phone = pxOfPoint(camera, PHONE);
      // On the mug: the mug is nearer than the phone, whatever the radius allows.
      mapper.handlePointerDown(click(mug.x, mug.y));
      expect(commands).toEqual([{ type: 'TapObject', t: 234, objectId: 'mug_01' }]);
      commands.length = 0;
      mapper.handlePointerDown(click(phone.x, phone.y));
      expect(commands).toEqual([{ type: 'TapObject', t: 234, objectId: 'phone' }]);
    });

    it('gives a tie between a prop and an object to the object', () => {
      // The mug lies exactly where the phone is drawn: the finger is as near to both.
      const { mapper, commands, camera, setObjects } = rush([
        { ...MUG, xM: PHONE.xM, yM: PHONE.yM, zM: PHONE.zM },
      ]);
      setObjects([PHONE]);
      const at = pxOfPoint(camera, PHONE);
      mapper.handlePointerDown(click(at.x, at.y));
      expect(commands).toEqual([{ type: 'TapObject', t: 234, objectId: 'phone' }]);
    });

    it('weighs a prop against the baby as it does an object: nearer wins, a tie goes to the baby', () => {
      const { mapper, sim, commands, camera } = rush();
      const mug = pxOfPoint(camera, MUG);
      // The baby stands beside the mug but his centre is farther from the finger.
      Object.assign(sim.world.baby, { xM: MUG.xM + 0.35, zM: MUG.zM, state: 'babble' });
      mapper.handlePointerDown(click(mug.x, mug.y));
      expect(commands).toEqual([{ type: 'TapObject', t: 234, objectId: 'mug_01' }]);
      commands.length = 0;
      // The baby on the mug itself: a tie goes to him.
      Object.assign(sim.world.baby, { xM: MUG.xM, zM: MUG.zM });
      sim.world.props[0] = { ...MUG, yM: BABY_RADIUS_M };
      mapper.handlePointerDown(click(mug.x, mug.y));
      expect(commands.map((c) => c.type)).toEqual(['TapBaby']);
    });

    it('still taps an object in a level without a rush', () => {
      const { mapper, commands, camera, setObjects } = setup();
      setObjects([PHONE]);
      const at = pxOfPoint(camera, PHONE);
      mapper.handlePointerDown(click(at.x, at.y));
      expect(commands).toEqual([{ type: 'TapObject', t: 234, objectId: 'phone' }]);
    });
  });

  describe('Space / A', () => {
    it('sends TapObject for the nearest prop that is a mess within contextReachM, ahead of everything', () => {
      const { mapper, sim, commands, setObjects } = rush([
        { ...MUG, xM: 1.2, zM: 0 },
        { ...BOOK, xM: 0.9, zM: 0 },
      ]);
      setObjects([PHONE]);
      Object.assign(sim.world.baby, { xM: 0.1, zM: 0, state: 'babble' });
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands).toEqual([{ type: 'TapObject', t: 500, objectId: 'book_01' }]);
    });

    it('also tidies with the baby in the arms', () => {
      const { mapper, sim, commands } = rush([{ ...MUG, xM: 0.5, zM: 0 }]);
      Object.assign(sim.world.baby, { xM: 0, zM: 0, state: 'carried' });
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands).toEqual([{ type: 'TapObject', t: 500, objectId: 'mug_01' }]);
    });

    it('behaves as before with no prop in reach: the baby, an object, or nothing', () => {
      const far = rush([{ ...MUG, xM: 6, zM: 0 }]);
      Object.assign(far.sim.world.baby, { xM: 0.3, zM: 0, state: 'babble' });
      far.mapper.handleAction('down', 1500, 'keyboard');
      expect(far.commands).toEqual([{ type: 'TapBaby', t: 500 }]);
      const none = rush([{ ...MUG, xM: 0.5, zM: 0, isMess: false }]);
      none.mapper.handleAction('down', 1500, 'keyboard');
      expect(none.commands).toEqual([]);
    });

    it('answers a threat that is up first, with the keyboard and with the pad', () => {
      for (const device of ['keyboard', 'gamepad'] as const) {
        const { mapper, sim, commands } = rush([{ ...MUG, xM: 0.5, zM: 0 }]);
        sim.world.threats = [threatAt(1, 2, 0, 1000)];
        mapper.handleAction('down', 1500, device);
        expect(
          commands.map((c) => c.type),
          device,
        ).toEqual(['PressThreat']);
      }
    });

    it('tidies with the pad as with the keyboard when no threat is up', () => {
      const { mapper, commands } = rush([{ ...MUG, xM: 0.5, zM: 0 }]);
      mapper.handleAction('down', 1500, 'gamepad');
      expect(commands).toEqual([{ type: 'TapObject', t: 500, objectId: 'mug_01' }]);
    });

    it('ignores a mess outside the rush', () => {
      const { mapper, sim, commands } = rush([{ ...MUG, xM: 0.5, zM: 0 }]);
      sim.world.flow.state = 'playing';
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands).toEqual([]);
    });
  });
});

describe('createInputMapper: the debris of the coffee table (story 3.15)', () => {
  const MUG = {
    id: 'mug_01',
    xM: 0.8,
    yM: 0.05,
    zM: 0.2,
    isMess: true,
    debrisPickUpMs: 1500,
  };
  const CUSHION = { id: 'cushion_01', xM: -1.4, yM: 0.05, zM: -1, isMess: true };
  const pxOfPoint = (
    camera: Parameters<typeof Vector3.prototype.project>[0],
    o: { xM: number; yM: number; zM: number },
  ) => {
    const v = new Vector3(o.xM, o.yM, o.zM).project(camera);
    return {
      x: RECT.left + ((v.x + 1) / 2) * RECT.width,
      y: RECT.top + ((1 - v.y) / 2) * RECT.height,
    };
  };

  function playing(props: unknown[] = [MUG, CUSHION]) {
    const harness = setup();
    (harness.sim.world.props as unknown[]).push(...props.map((prop) => ({ ...(prop as object) })));
    return harness;
  }

  it('taps a debris during the level, and only a debris: a mess without the mark is just floor', () => {
    const { mapper, commands, markers, camera } = playing();
    const mug = pxOfPoint(camera, MUG);
    mapper.handlePointerDown(click(mug.x, mug.y));
    expect(commands).toEqual([{ type: 'TapObject', t: 234, objectId: 'mug_01' }]);
    expect(markers).toEqual([[MUG.xM, MUG.zM]]);
    commands.length = 0;
    const cushion = pxOfPoint(camera, CUSHION);
    mapper.handlePointerDown(click(cushion.x, cushion.y));
    expect(commands.map((c) => c.type)).toEqual(['TapFloor']);
  });

  describe('Space / A', () => {
    it('walks to the nearest debris within contextReachM, and ignores a mess that is no debris', () => {
      const { mapper, commands } = playing();
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands).toEqual([{ type: 'TapObject', t: 500, objectId: 'mug_01' }]);
      const none = playing([{ ...CUSHION, xM: 0.5, zM: 0 }]);
      none.mapper.handleAction('down', 1500, 'keyboard');
      expect(none.commands).toEqual([]);
    });

    it('lets the baby come first while he is in the arms (put down) or at the bottom of the stairs (fetch)', () => {
      for (const state of ['carried', 'downstairs']) {
        const { mapper, sim, commands } = playing();
        Object.assign(sim.world.baby, { xM: 0.1, zM: 0, state });
        mapper.handleAction('down', 1500, 'keyboard');
        expect(commands, state).toEqual([{ type: 'TapBaby', t: 500 }]);
      }
    });

    it('picks the debris up with a free baby in reach, as it does with none', () => {
      const { mapper, sim, commands } = playing();
      Object.assign(sim.world.baby, { xM: 0.1, zM: 0, state: 'babble' });
      mapper.handleAction('down', 1500, 'keyboard');
      expect(commands).toEqual([{ type: 'TapObject', t: 500, objectId: 'mug_01' }]);
    });
  });

  describe('the baby at the bottom of the stairs', () => {
    const BABY = { xM: -1, zM: 0.5 };
    const SLIDE = { xM: -2, zM: 0.8 };

    it('is aimed where he is drawn (slid away from his sim point), not at his sim point', () => {
      const { mapper, sim, commands, setBabySlide, camera } = playing([]);
      Object.assign(sim.world.baby, { ...BABY, state: 'downstairs' });
      setBabySlide(SLIDE.xM, SLIDE.zM);
      const drawn = pxOfPoint(camera, {
        xM: BABY.xM + SLIDE.xM,
        yM: BABY_RADIUS_M,
        zM: BABY.zM + SLIDE.zM,
      });
      mapper.handlePointerDown(click(drawn.x, drawn.y));
      expect(commands).toEqual([{ type: 'TapBaby', t: 234 }]);
    });

    it('is not aimed at his sim point once he is drawn elsewhere', () => {
      const { mapper, sim, commands, setBabySlide, camera } = playing([]);
      Object.assign(sim.world.baby, { ...BABY, state: 'downstairs' });
      setBabySlide(SLIDE.xM, SLIDE.zM);
      const sim_ = pxOfPoint(camera, { ...BABY, yM: BABY_RADIUS_M });
      const drawn = pxOfPoint(camera, {
        xM: BABY.xM + SLIDE.xM,
        yM: BABY_RADIUS_M,
        zM: BABY.zM + SLIDE.zM,
      });
      // Only meaningful if the two points are farther apart than the touch radius.
      expect(Math.hypot(sim_.x - drawn.x, sim_.y - drawn.y)).toBeGreaterThan(
        OBJECT_TOUCH_RADIUS_PX,
      );
      mapper.handlePointerDown(click(sim_.x, sim_.y));
      expect(commands.map((c) => c.type)).toEqual(['TapFloor']);
    });

    it('ignores the slide for a baby who is not downstairs', () => {
      const { mapper, sim, commands, setBabySlide, camera } = playing([]);
      Object.assign(sim.world.baby, { ...BABY, state: 'babble' });
      setBabySlide(SLIDE.xM, SLIDE.zM);
      const at = pxOfPoint(camera, { ...BABY, yM: BABY_RADIUS_M });
      mapper.handlePointerDown(click(at.x, at.y));
      expect(commands).toEqual([{ type: 'TapBaby', t: 234 }]);
    });
  });
});

describe('createInputMapper: the calibration offset (story 2.7)', () => {
  const ICON = {
    threatId: 4,
    xM: -3,
    yM: 0.3,
    zM: 0.5,
    icon: 'bolt' as const,
    followsPapa: false,
    verb: '',
    iconShape: 'circle' as const,
    color: 'parry' as const,
    verbWidthPx: 0,
    verbHeightPx: 0,
    verbOffsetPx: 0,
  };
  const threatInWorld = {
    id: 4,
    state: 'windowOpen',
    xM: -3,
    zM: 0.5,
    windowOpenAt: 1000,
    responseWindow: { windowMs: 600, perfectMs: 100, toleranceMs: 30, bufferMs: 100 },
  } as never;

  function withThreat(offsetMs: number) {
    const env = setup();
    env.setOffset(offsetMs);
    env.sim.world.threats = [threatInWorld];
    env.setTargets({ threats: [{ id: 4, state: 'windowOpen' } as never], entries: [ICON] });
    const probe = new Vector3(ICON.xM, ICON.yM, ICON.zM).project(env.camera);
    const iconPx = {
      x: RECT.left + ((probe.x + 1) / 2) * RECT.width,
      y: RECT.top + ((1 - probe.y) / 2) * RECT.height,
    };
    return { ...env, iconPx };
  }

  it('moves nothing at an offset of 0: every stamp is the raw event stamp', () => {
    const { mapper, commands, iconPx } = withThreat(0);
    mapper.handlePointerDown(click(iconPx.x, iconPx.y, { timeStamp: 1500 }));
    mapper.handlePointerUp(click(iconPx.x, iconPx.y, { timeStamp: 1620 }));
    expect(commands).toEqual([
      { type: 'PressThreat', t: 500, threatId: 4 },
      { type: 'Release', t: 620 },
    ]);
  });

  it('subtracts the offset from a press and from its release alike, so a hold keeps its length', () => {
    const { mapper, commands, iconPx } = withThreat(100);
    mapper.handlePointerDown(click(iconPx.x, iconPx.y, { timeStamp: 1500 }));
    mapper.handlePointerUp(click(iconPx.x, iconPx.y, { timeStamp: 1620 }));
    expect(commands).toEqual([
      { type: 'PressThreat', t: 400, threatId: 4 },
      { type: 'Release', t: 520 },
    ]);
  });

  it('subtracts it from a floor tap, a baby tap and an object tap', () => {
    const floor = setup();
    floor.setOffset(100);
    floor.mapper.handlePointerDown(
      click(RECT.left + RECT.width / 2, RECT.top + RECT.height / 2, { timeStamp: 1234 }),
    );
    expect(floor.commands[0]).toMatchObject({ type: 'TapFloor', t: 134 });

    const object = setup();
    object.setOffset(100);
    const target = { id: 'coffee_machine', xM: 2, yM: 0.5, zM: -1 } as ObjectTarget;
    object.setObjects([target]);
    const probe = new Vector3(target.xM, target.yM, target.zM).project(object.camera);
    object.mapper.handlePointerDown(
      click(
        RECT.left + ((probe.x + 1) / 2) * RECT.width,
        RECT.top + ((1 - probe.y) / 2) * RECT.height,
        { timeStamp: 1234 },
      ),
    );
    expect(object.commands[0]).toMatchObject({ type: 'TapObject', t: 134 });
  });

  it('subtracts it from the movement keys', () => {
    const { mapper, held, commands, setOffset } = setup();
    setOffset(100);
    held.add('KeyD');
    mapper.onKeysChanged(1500);
    expect(commands[0]).toMatchObject({ type: 'Move', t: 400 });
    held.clear();
    mapper.onKeysChanged(1600);
    expect(commands[1]).toEqual({ type: 'MoveStop', t: 500 });
  });

  it('subtracts it from Space down and up', () => {
    const { mapper, commands } = withThreat(100);
    mapper.handleAction('down', 1500, 'keyboard');
    mapper.handleAction('up', 1620, 'keyboard');
    expect(commands).toEqual([
      { type: 'PressThreat', t: 400, threatId: 4 },
      { type: 'Release', t: 520 },
    ]);
  });

  it('subtracts it from the pad edge stamps (A down and up) and from the stick, stamped at now', () => {
    const { mapper, pad, commands, state, setNow } = withThreat(100);
    pad.isPresent = true;
    pad.stampAtReal = 1990;
    pad.pressed = ['confirm'];
    mapper.pollGamepad();
    pad.stampAtReal = 2040;
    pad.released = ['confirm'];
    mapper.pollGamepad();
    expect(commands).toEqual([
      { type: 'PressThreat', t: 890, threatId: 4 },
      { type: 'Release', t: 940 },
    ]);
    // The stick's Move is stamped at "now" (real 2000 -> sim 1000), also corrected.
    commands.length = 0;
    setNow(2000);
    state.stick = { x: 1, y: 0 };
    mapper.pollGamepad();
    expect(commands[0]).toMatchObject({ type: 'Move', t: 900 });
  });

  it('keeps the sim clock stamp of a resume uncorrected: it is not an input stamp', () => {
    const { mapper, held, commands, setOffset } = setup();
    setOffset(100);
    held.add('KeyD');
    mapper.resync();
    expect(commands[0]).toMatchObject({ type: 'Move', t: 777 });
  });

  it('applies a new offset to the very next input', () => {
    const { mapper, commands, setOffset, iconPx } = withThreat(0);
    mapper.handlePointerDown(click(iconPx.x, iconPx.y, { timeStamp: 1500 }));
    setOffset(250);
    mapper.handlePointerUp(click(iconPx.x, iconPx.y, { timeStamp: 1620 }));
    // A hold across a recalibration: the Release is not dated before its press.
    expect(commands[1]).toEqual({ type: 'Release', t: 500 });
  });

  it('handles a negative offset: the stamp moves ahead of the event', () => {
    const { mapper, commands, iconPx } = withThreat(-50);
    mapper.handlePointerDown(click(iconPx.x, iconPx.y, { timeStamp: 1500 }));
    expect(commands[0]).toEqual({ type: 'PressThreat', t: 550, threatId: 4 });
  });
});

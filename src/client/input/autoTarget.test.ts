import { AUTO_TARGET_ON_PAPA_M } from '@shared/constants';
import { log } from '@shared/log';
import { asSimMs } from '@shared/time';
import type { ThreatInstance } from '@sim';
import { describe, expect, it } from 'vitest';
import { createTestContent } from '../../../tests/support/testContent.ts';
import { pickAutoTarget } from './autoTarget.ts';
import type { FloorDir } from './moveDirection.ts';

const CONE_DEG = createTestContent().feel.input.autoTargetConeDeg;
const HALF_RAD = (CONE_DEG / 2) * (Math.PI / 180);

interface Spec {
  id: number;
  xM?: number;
  zM?: number;
  state?: ThreatInstance['state'];
  windowOpenAt?: number;
  windowMs?: number | null;
}

/** A hand-built instance: only the fields the pick reads matter. */
function threat(spec: Spec): ThreatInstance {
  return {
    id: spec.id,
    defId: 'outlet',
    anchorId: 'outlet_01',
    xM: spec.xM ?? 0,
    zM: spec.zM ?? 0,
    state: spec.state ?? 'telegraph',
    enteredAt: asSimMs(0),
    windowOpenAt: asSimMs(spec.windowOpenAt ?? 1000),
    responseWindow:
      spec.windowMs === null
        ? null
        : { windowMs: spec.windowMs ?? 600, perfectMs: 100, toleranceMs: 30, bufferMs: 100 },
    press: null,
  };
}

const AIM_RIGHT: FloorDir = { x: 1, z: 0 };
const polar = (angleRad: number, radiusM: number) => ({
  xM: Math.cos(angleRad) * radiusM,
  zM: Math.sin(angleRad) * radiusM,
});

describe('pickAutoTarget: who is a candidate', () => {
  it('picks nothing when no threat is active', () => {
    expect(pickAutoTarget([], 0, 0, null, CONE_DEG)).toBeNull();
    const none = [
      threat({ id: 1, state: 'idle' }),
      threat({ id: 2, state: 'resolved' }),
      threat({ id: 3, state: 'gag' }),
    ];
    expect(pickAutoTarget(none, 0, 0, null, CONE_DEG)).toBeNull();
    expect(pickAutoTarget(none, 0, 0, AIM_RIGHT, CONE_DEG)).toBeNull();
  });

  it('counts a threat in telegraph and one whose window is open', () => {
    expect(pickAutoTarget([threat({ id: 1, state: 'telegraph' })], 0, 0, null, CONE_DEG)).toBe(1);
    expect(pickAutoTarget([threat({ id: 1, state: 'windowOpen' })], 0, 0, null, CONE_DEG)).toBe(1);
  });

  it('skips an active threat with no window, and says so once per threat id', () => {
    const before = log.buffer().length;
    const broken = threat({ id: 71, windowMs: null });
    expect(pickAutoTarget([broken], 0, 0, null, CONE_DEG)).toBeNull();
    expect(pickAutoTarget([broken], 0, 0, AIM_RIGHT, CONE_DEG)).toBeNull();
    const warnings = log
      .buffer()
      .slice(before)
      .filter((entry) => entry.level === 'warn' && entry.message.includes('no response window'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.data).toEqual({ threatId: 71 });
  });
});

describe('pickAutoTarget: urgency', () => {
  it('picks the window that closes first, not the nearest threat', () => {
    const threats = [
      threat({ id: 1, xM: 1, windowOpenAt: 3000 }),
      threat({ id: 2, xM: 5, windowOpenAt: 1000 }),
    ];
    expect(pickAutoTarget(threats, 0, 0, null, CONE_DEG)).toBe(2);
  });

  it('reads the window length: equal opening, the shorter window closes first', () => {
    const threats = [
      threat({ id: 1, windowOpenAt: 1000, windowMs: 800 }),
      threat({ id: 2, windowOpenAt: 1000, windowMs: 500 }),
    ];
    expect(pickAutoTarget(threats, 0, 0, null, CONE_DEG)).toBe(2);
  });

  it('closes by opening plus length: a later opening with a shorter window can win', () => {
    const threats = [
      threat({ id: 1, windowOpenAt: 1000, windowMs: 900 }), // closes at 1900
      threat({ id: 2, windowOpenAt: 1500, windowMs: 200 }), // closes at 1700
    ];
    expect(pickAutoTarget(threats, 0, 0, null, CONE_DEG)).toBe(2);
  });

  it('gives a tie to the lower id, whatever the list order', () => {
    const a = threat({ id: 4, windowOpenAt: 1000, windowMs: 600 });
    const b = threat({ id: 2, windowOpenAt: 1200, windowMs: 400 });
    expect(pickAutoTarget([a, b], 0, 0, null, CONE_DEG)).toBe(2);
    expect(pickAutoTarget([b, a], 0, 0, null, CONE_DEG)).toBe(2);
    expect(pickAutoTarget([a, b], 0, 0, AIM_RIGHT, CONE_DEG)).toBe(2);
    expect(pickAutoTarget([b, a], 0, 0, AIM_RIGHT, CONE_DEG)).toBe(2);
  });
});

describe('pickAutoTarget: the cone', () => {
  it('prefers the threat in the cone to a more urgent one outside it', () => {
    const urgentBehind = threat({ id: 1, xM: -3, windowOpenAt: 1000 });
    const laterAhead = threat({ id: 2, xM: 3, windowOpenAt: 5000 });
    expect(pickAutoTarget([urgentBehind, laterAhead], 0, 0, AIM_RIGHT, CONE_DEG)).toBe(2);
    expect(pickAutoTarget([urgentBehind, laterAhead], 0, 0, null, CONE_DEG)).toBe(1);
  });

  it('takes the most urgent of those in the cone', () => {
    const near = threat({ id: 1, xM: 1, windowOpenAt: 4000 });
    const far = threat({ id: 2, xM: 4, windowOpenAt: 2000 });
    expect(pickAutoTarget([near, far], 0, 0, AIM_RIGHT, CONE_DEG)).toBe(2);
  });

  it('falls back to the most urgent overall when nothing is in the cone (D3)', () => {
    const threats = [
      threat({ id: 1, ...polar(Math.PI, 2), windowOpenAt: 3000 }),
      threat({ id: 2, ...polar(Math.PI / 2, 2), windowOpenAt: 2000 }),
    ];
    expect(pickAutoTarget(threats, 0, 0, AIM_RIGHT, CONE_DEG)).toBe(2);
  });

  it('includes the edge of the cone, and excludes just past it', () => {
    const justInside = threat({ id: 1, ...polar(HALF_RAD - 1e-6, 2), windowOpenAt: 5000 });
    const justOutside = threat({ id: 2, ...polar(HALF_RAD + 1e-6, 2), windowOpenAt: 1000 });
    expect(pickAutoTarget([justInside, justOutside], 0, 0, AIM_RIGHT, CONE_DEG)).toBe(1);
    // Symmetric on the other side of the aim.
    const below = threat({ id: 3, ...polar(-(HALF_RAD - 1e-6), 2), windowOpenAt: 5000 });
    expect(pickAutoTarget([below, justOutside], 0, 0, AIM_RIGHT, CONE_DEG)).toBe(3);
  });

  it('includes a threat exactly at the half-angle (inclusive)', () => {
    // 90° cone, aim along x: a threat at (1, 1) is exactly at 45°. Rounding of the cosine is the
    // function's to absorb; the test keeps to an exactly representable pair.
    const atEdge = threat({ id: 1, xM: 1, zM: 1, windowOpenAt: 5000 });
    const outside = threat({ id: 2, xM: 0.5, zM: 1, windowOpenAt: 1000 });
    expect(pickAutoTarget([atEdge, outside], 0, 0, AIM_RIGHT, 90)).toBe(1);
  });

  it('measures from Papa, not from the origin', () => {
    const t = threat({ id: 1, xM: 5, zM: 5 });
    expect(
      pickAutoTarget(
        [t, threat({ id: 2, xM: 8, zM: 5, windowOpenAt: 9000 })],
        4,
        5,
        AIM_RIGHT,
        CONE_DEG,
      ),
    ).toBe(1);
    const left = threat({ id: 3, xM: 3, zM: 5, windowOpenAt: 9000 });
    const ahead = threat({ id: 4, xM: 6, zM: 5, windowOpenAt: 9500 });
    expect(pickAutoTarget([left, ahead], 4, 5, AIM_RIGHT, CONE_DEG)).toBe(4);
  });

  it('counts a threat on Papa in every cone', () => {
    const onPapa = threat({ id: 1, xM: 2, zM: 3, windowOpenAt: 5000 });
    const ahead = threat({ id: 2, xM: 6, zM: 3, windowOpenAt: 1000 });
    // The urgent one ahead wins when it is in the cone...
    expect(pickAutoTarget([onPapa, ahead], 2, 3, AIM_RIGHT, CONE_DEG)).toBe(2);
    // ...and the one under Papa is in the cone when aiming away from the other.
    expect(pickAutoTarget([onPapa, ahead], 2, 3, { x: -1, z: 0 }, CONE_DEG)).toBe(1);
    const nearlyOn = threat({ id: 3, xM: 2 + AUTO_TARGET_ON_PAPA_M / 2, zM: 3 });
    expect(pickAutoTarget([nearlyOn], 2, 3, { x: -1, z: 0 }, 10)).toBe(3);
  });

  it('accepts everything, behind included, with a 360° cone', () => {
    const behind = threat({ id: 1, xM: -3, windowOpenAt: 1000 });
    const ahead = threat({ id: 2, xM: 3, windowOpenAt: 5000 });
    expect(pickAutoTarget([ahead, behind], 0, 0, AIM_RIGHT, 360)).toBe(1);
  });

  it('keeps a very small cone to the aim line', () => {
    const onLine = threat({ id: 1, xM: 3, zM: 0, windowOpenAt: 5000 });
    const slightlyOff = threat({ id: 2, xM: 3, zM: 0.2, windowOpenAt: 1000 });
    expect(pickAutoTarget([onLine, slightlyOff], 0, 0, AIM_RIGHT, 1)).toBe(1);
    expect(pickAutoTarget([onLine, slightlyOff], 0, 0, AIM_RIGHT, CONE_DEG)).toBe(2);
  });

  it('reads the cone from its argument on each call', () => {
    const at40 = threat({ id: 1, ...polar((40 * Math.PI) / 180, 2), windowOpenAt: 5000 });
    const urgent = threat({ id: 2, xM: -3, windowOpenAt: 1000 });
    expect(pickAutoTarget([at40, urgent], 0, 0, AIM_RIGHT, 60)).toBe(2); // 40° > 30°: outside, falls back
    expect(pickAutoTarget([at40, urgent], 0, 0, AIM_RIGHT, 90)).toBe(1); // 40° < 45°: inside
  });

  it.each([
    ['right', { x: 1, z: 0 }, { xM: 3, zM: 0 }],
    ['left', { x: -1, z: 0 }, { xM: -3, zM: 0 }],
    ['towards the viewer', { x: 0, z: 1 }, { xM: 0, zM: 3 }],
    ['away', { x: 0, z: -1 }, { xM: 0, zM: -3 }],
    ['the four diagonals, down-right', { x: Math.SQRT1_2, z: Math.SQRT1_2 }, { xM: 2, zM: 2 }],
    ['up-left', { x: -Math.SQRT1_2, z: -Math.SQRT1_2 }, { xM: -2, zM: -2 }],
    ['up-right', { x: Math.SQRT1_2, z: -Math.SQRT1_2 }, { xM: 2, zM: -2 }],
    ['down-left', { x: -Math.SQRT1_2, z: Math.SQRT1_2 }, { xM: -2, zM: 2 }],
  ])('finds the threat straight ahead when aiming %s', (_name, aim, where) => {
    const ahead = threat({ id: 5, ...where, windowOpenAt: 6000 });
    // The others sit opposite and are more urgent: only the cone can pick `ahead`.
    const opposite = threat({ id: 1, xM: -where.xM, zM: -where.zM, windowOpenAt: 1000 });
    expect(pickAutoTarget([opposite, ahead], 0, 0, aim, CONE_DEG)).toBe(5);
  });
});

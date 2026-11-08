import { botViewOf, createVisibilityCounters } from '@bots/botView';
import { THREAT_MARKER_OFFSET_M } from '@shared/constants';
import { roomOf } from '@shared/followCamera';
import { describe, expect, it } from 'vitest';

const geometry = {
  boundsMinM: [-7, -0.8, -3.5] as [number, number, number],
  boundsMaxM: [7.5, 2.5, 3.5] as [number, number, number],
  anchors: [
    { id: 'stove', positionM: [-5, 0.9, -3] as [number, number, number] },
    { id: 'outlet_01', positionM: [1.6, 0.3, -3.4] as [number, number, number] },
  ],
};
const threats = {
  outlet: { target: 'anchor' },
  micro: { target: 'papa' },
  silence: { target: 'hiddenZone' },
  pot: { target: 'station' },
} as const;
const screen = { widthPx: 844, heightPx: 390, hudBottomPx: 56, bubbleReadMs: 100 };

describe('botViewOf', () => {
  it('gives null in a fixed-camera level: the bots there play exactly as before', () => {
    expect(
      botViewOf({ camera: 'fixed', geometry, threats, babyBodyRadiusM: 0.2, screen }),
    ).toBeNull();
  });

  it('gives the room, the screen and the marker points of a follow level', () => {
    const view = botViewOf({ camera: 'follow', geometry, threats, babyBodyRadiusM: 0.2, screen });
    expect(view).not.toBeNull();
    if (view === null) return;
    expect(view.room).toEqual(roomOf(geometry));
    expect(view.screen).toEqual({ widthPx: 844, heightPx: 390, isCompact: true, hudBottomPx: 56 });
    expect(view.bubbleReadMs).toBe(100);
    expect(view.anchors.outlet_01).toEqual([1.6, 0.3, -3.4]);
    expect(view.anchors.stove).toEqual([-5, 0.9, -3]);
    expect(view.targets).toEqual({
      outlet: 'anchor',
      micro: 'papa',
      silence: 'hiddenZone',
      pot: 'station',
    });
    // The baby's marker stands above his cube (twice his radius), as the client's does.
    expect(view.babyMarkerYM).toBeCloseTo(0.4 + THREAT_MARKER_OFFSET_M, 9);
  });

  it('derives the surface as the client does: a tablet is regular, a phone compact', () => {
    const tablet = botViewOf({
      camera: 'follow',
      geometry,
      threats,
      babyBodyRadiusM: 0.2,
      screen: { ...screen, widthPx: 1024, heightPx: 768 },
    });
    expect(tablet?.screen.isCompact).toBe(false);
  });
});

describe('createVisibilityCounters', () => {
  it('starts at zero, a fresh object each time', () => {
    const first = createVisibilityCounters();
    expect(first).toEqual({
      telegraphs: 0,
      seenOffscreen: 0,
      cappedMs: 0,
      neverSeen: 0,
      seenLate: 0,
      seenLateDelayMs: 0,
    });
    first.telegraphs = 3;
    expect(createVisibilityCounters().telegraphs).toBe(0);
  });
});

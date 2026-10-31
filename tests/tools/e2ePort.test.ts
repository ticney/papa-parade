import { describe, expect, it } from 'vitest';
import { DIST_PORT_OFFSET } from '../../src/shared/constants.ts';
import {
  distPortFor,
  e2eDistPort,
  e2ePort,
  isBrowserBlockedPort,
  nextBrowserSafePort,
  worktreePortFor,
} from '../e2e/support/e2ePort.ts';

// The worktree ports are `5180 + (hash % 800)`, so every one of 5180-5979 is possible.
const WORKTREE_PORTS = Array.from({ length: 800 }, (_, i) => 5180 + i);

describe('isBrowserBlockedPort', () => {
  it.each([6666, 6665, 6669, 6000, 5060, 6566, 6679, 6697, 10080])('refuses %i', (port) => {
    expect(isBrowserBlockedPort(port)).toBe(true);
  });

  it.each([5179, 5666, 6667 + 3, 7179, 8080])('accepts %i', (port) => {
    expect(isBrowserBlockedPort(port)).toBe(false);
  });
});

describe('nextBrowserSafePort', () => {
  it('keeps a port that is fine and steps past a run of refused ones', () => {
    expect(nextBrowserSafePort(7179)).toBe(7179);
    expect(nextBrowserSafePort(6665)).toBe(6670);
  });
});

describe('distPortFor', () => {
  it('is the dev port plus the offset when that port is fine', () => {
    expect(distPortFor(5179)).toBe(5179 + DIST_PORT_OFFSET);
    expect(distPortFor(5700)).toBe(5700 + DIST_PORT_OFFSET);
  });

  it('is never a port a browser refuses, for any worktree port (5666 → 6666 did)', () => {
    for (const devPort of WORKTREE_PORTS) {
      expect(isBrowserBlockedPort(distPortFor(devPort)), `dev port ${devPort}`).toBe(false);
    }
    expect(distPortFor(5666)).not.toBe(6666);
  });

  it('keeps two worktrees apart: no two dev ports share a dist port, the fallback included', () => {
    const dist = WORKTREE_PORTS.map(distPortFor);
    expect(new Set(dist).size).toBe(dist.length);
  });

  it('keeps the dist port apart from every dev port, the main checkout’s included', () => {
    const dev = new Set([5179, ...WORKTREE_PORTS]);
    for (const devPort of [5179, ...WORKTREE_PORTS]) {
      expect(dev.has(distPortFor(devPort)), `dev port ${devPort}`).toBe(false);
    }
  });

  it('fails loudly above 65535', () => {
    expect(() => distPortFor(65000)).toThrow(/above 65535/);
  });
});

describe('a forced port', () => {
  const withEnv = <T>(variable: string, value: string, run: () => T): T => {
    const before = process.env[variable];
    process.env[variable] = value;
    try {
      return run();
    } finally {
      if (before === undefined) delete process.env[variable];
      else process.env[variable] = before;
    }
  };

  it('is used as given when a browser accepts it', () => {
    expect(withEnv('PP_E2E_DIST_PORT', '7179', e2eDistPort)).toBe(7179);
    expect(withEnv('PP_E2E_PORT', '5300', e2ePort)).toBe(5300);
  });

  it('is refused when a browser would, with the reason, instead of failing at the first page load', () => {
    expect(() => withEnv('PP_E2E_DIST_PORT', '6666', e2eDistPort)).toThrow(/ERR_UNSAFE_PORT/);
    expect(() => withEnv('PP_E2E_PORT', '6000', e2ePort)).toThrow(/PP_E2E_PORT=6000/);
  });
});

describe('worktreePortFor', () => {
  it('stays in the worktree range for any hash, and never lands on a refused port', () => {
    for (let hash = 0; hash <= 0xffff; hash += 7) {
      const port = worktreePortFor(hash);
      expect(isBrowserBlockedPort(port), `hash ${hash}`).toBe(false);
      expect(port).toBeGreaterThanOrEqual(5180);
      expect(port).toBeLessThan(5180 + 800 + 20);
    }
  });
});

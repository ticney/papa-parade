import { log } from '@shared/log';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  FakeCssStyleSheet,
  FakeDocument,
  FakeNode,
  FakePane,
  FakeStyleElement,
} from '../../tests/support/fakePane.ts';
import { createFakeTestHost } from '../../tests/support/fakeTestHost.ts';
import { createTestContent } from '../../tests/support/testContent.ts';
import { createSoundBoard } from './soundBoard.ts';

vi.mock('tweakpane', async () => {
  const fakes = await import('../../tests/support/fakePane.ts');
  return { Pane: fakes.FakePane };
});

beforeAll(() => {
  log.setLevel('error');
});

afterEach(() => {
  FakePane.instances = [];
  vi.unstubAllGlobals();
});

function createRig(options: { isAudioRunning?: boolean } = {}) {
  const content = createTestContent();
  // A cue with a sound and layers, and one that has only a vibration (the test table has one).
  content.feedback.cues.laugh_burst = {
    audio: { clip: 'papa_bump', bus: 'sfx', gainPct: 100 },
    layers: [
      { clip: 'baby_laugh_perfect', bus: 'voice', gainPct: 100 },
      { clip: 'baby_laugh_perfect', bus: 'voice', gainPct: 50 },
    ],
    haptic: 'heavy',
  };
  const host = createFakeTestHost({ content, isAudioRunning: options.isAudioRunning });
  const doc = new FakeDocument();
  const container = new FakeNode('div', doc);
  const board = createSoundBoard({ host, container: container as unknown as HTMLElement });
  const pane = FakePane.instances[FakePane.instances.length - 1] as FakePane;
  const status = (): string => container.findAll('pp-debug-sound-status')[0]?.textContent ?? '';
  const button = (title: string) => pane.buttons.find((candidate) => candidate.title === title);
  return { host, board, pane, status, button, container };
}

describe('the sound board (story 2.3 AC 14)', () => {
  it('is a « Sons » pane with one button per cue that has a sound, sorted, and none for the others', () => {
    const { pane } = createRig();
    expect(pane.title).toBe('Sons');
    expect(pane.buttons.map((button) => button.title)).toEqual(['laugh_burst +2', 'papa_bump']);
  });

  it('plays a cue through the host when its button is tapped, and says which', () => {
    const { host, button, status } = createRig();
    button('papa_bump')?.click();
    expect(host.calls).toEqual(['audition:papa_bump']);
    expect(status()).toContain('papa_bump');
  });

  it('does nothing else than audition: no pause, no step hook, no input block', () => {
    const { host, button } = createRig();
    button('laugh_burst +2')?.click();
    expect(host.calls).toEqual(['audition:laugh_burst']);
    expect(host.stepHook).toBeNull();
    expect(host.isGameInputBlocked).toBe(false);
  });

  it('says in English that nothing played when the audio context is not running', () => {
    const { host, button, status } = createRig({ isAudioRunning: false });
    button('papa_bump')?.click();
    expect(host.calls).toEqual(['audition:papa_bump']);
    expect(status()).toMatch(/audio is not running/i);
    expect(status()).toMatch(/touch|tap/i);
  });

  it('leaves the container as it was when the build throws, and the pane is disposed', () => {
    const host = createFakeTestHost({ content: createTestContent() });
    const broken = Object.create(host, {
      content: {
        get() {
          throw new Error('no content');
        },
      },
    }) as typeof host;
    const container = new FakeNode('div', new FakeDocument());
    const before = container.children.length;
    expect(() =>
      createSoundBoard({ host: broken, container: container as unknown as HTMLElement }),
    ).toThrow('no content');
    expect(container.children.length).toBe(before);
    expect(container.findAll('pp-debug-sound-status')).toEqual([]);
    expect(FakePane.instances.length).toBeGreaterThan(0);
    expect(FakePane.instances.every((pane) => pane.isDisposed)).toBe(true);
    // A second attempt on the same container mounts exactly one board.
    createSoundBoard({ host, container: container as unknown as HTMLElement });
    expect(container.findAll('pp-debug-sound-status')).toHaveLength(1);
  });

  it('disposes its pane and its status line', () => {
    const { board, pane, container } = createRig();
    board.dispose();
    expect(pane.isDisposed).toBe(true);
    expect(container.findAll('pp-debug-sound-status')).toEqual([]);
  });

  it('builds on a page that has the CSSOM API (the CSP-safe pane factory)', () => {
    vi.stubGlobal('HTMLStyleElement', FakeStyleElement);
    vi.stubGlobal('CSSStyleSheet', FakeCssStyleSheet);
    expect(() => createRig()).not.toThrow();
  });
});

import { type Logger, log } from '@shared/log';
import { AnimationClip, Group } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestLevelGeometry } from '../../../tests/support/testLevelGeometry.ts';
import { fetchBytesWithTimeout, type LoadLevelDeps, loadLevelAssets } from './loadLevelAssets.ts';

const GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);
const geometryText = (id = 'test_room') => JSON.stringify(createTestLevelGeometry(id));

function deps(overrides: LoadLevelDeps = {}): LoadLevelDeps & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    baseUrl: './',
    fetchBytes: async (url) => {
      urls.push(url);
      return GLB;
    },
    loadGeometryText: async (id) => geometryText(id),
    parseModel: async () => new Group(),
    parseCharacter: async () => ({ scene: new Group(), animations: [] }),
    ...overrides,
  };
}

let warnings: unknown[][] = [];
beforeEach(() => {
  warnings = [];
  vi.spyOn(log, 'warn').mockImplementation(((...args: unknown[]) => {
    warnings.push(args);
  }) as Logger['warn']);
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function errorOf(overrides: LoadLevelDeps): Promise<string> {
  const result = await loadLevelAssets('test_room', deps(overrides));
  if (result.ok) throw new Error('expected an error');
  expect(result.error.kind).toBe('assets');
  return result.error.message;
}

describe('loadLevelAssets', () => {
  it('returns the geometry and the model, fetching under the base URL', async () => {
    const d = deps();
    const result = await loadLevelAssets('test_room', d);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe('test_room');
    expect(result.value.geometry.id).toBe('test_room');
    expect(result.value.model).toBeInstanceOf(Group);
    expect(d.urls).toEqual([
      './assets/levels/test_room.glb',
      './assets/characters/papa.glb',
      './assets/characters/baby.glb',
    ]);
    expect(warnings).toEqual([]);
  });

  it('returns both characters with their clips, under their own base URL', async () => {
    const bases: string[] = [];
    const clip = new AnimationClip('idle', 1, []);
    const result = await loadLevelAssets(
      'test_room',
      deps({
        parseCharacter: async (_bytes, baseUrl) => {
          bases.push(baseUrl);
          return { scene: new Group(), animations: [clip] };
        },
      }),
    );
    if (!result.ok) throw new Error('expected the assets');
    expect(result.value.characters.papa.animations).toEqual([clip]);
    expect(result.value.characters.baby.animations).toEqual([clip]);
    expect(bases).toEqual(['./assets/characters/', './assets/characters/']);
  });

  it('loads the three files in parallel: none waits for another', async () => {
    const started: string[] = [];
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loading = loadLevelAssets(
      'test_room',
      deps({
        fetchBytes: async (url) => {
          started.push(url);
          await held;
          return GLB;
        },
      }),
    );
    await Promise.resolve();
    expect(started).toHaveLength(3);
    release?.();
    expect((await loading).ok).toBe(true);
  });

  describe.each(['papa', 'baby'])('a broken %s.glb', (character) => {
    const file = `${character}.glb`;
    const only =
      (answer: () => Promise<Uint8Array>) =>
      (url: string): Promise<Uint8Array> =>
        url.endsWith(`/characters/${file}`) ? answer() : Promise.resolve(GLB);

    it('is an error naming the file when it is missing, with one warn', async () => {
      const message = await errorOf({
        fetchBytes: only(() => Promise.reject(new Error('HTTP 404'))),
      });
      expect(message).toBe(`cannot fetch ${file}: HTTP 404`);
      expect(warnings).toHaveLength(1);
    });

    it('is an error naming the file when HTML is served in its place', async () => {
      const html = new TextEncoder().encode('<!doctype html>');
      const message = await errorOf({ fetchBytes: only(() => Promise.resolve(html)) });
      expect(message).toBe(`${file} is not a glTF binary (it does not start with "glTF")`);
    });

    it('is an error naming the file when it cannot be parsed', async () => {
      const message = await errorOf({
        fetchBytes: only(() => Promise.resolve(new Uint8Array([...GLB, 1]))),
        parseCharacter: async (bytes) => {
          if (bytes.length > GLB.length) throw new Error('bad accessor');
          return { scene: new Group(), animations: [] };
        },
      });
      expect(message).toBe(`cannot parse ${file}: bad accessor`);
    });
  });

  it('fails with a message naming the glb when the fetch rejects', async () => {
    const message = await errorOf({
      fetchBytes: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    expect(message).toBe('cannot fetch test_room.glb: Failed to fetch');
  });

  it('fails on a non-OK status (the default fetch turns it into a rejection)', async () => {
    const message = await errorOf({
      fetchBytes: async () => {
        throw new Error('HTTP 404');
      },
    });
    expect(message).toContain('test_room.glb');
    expect(message).toContain('HTTP 404');
  });

  it('refuses an HTML body served as the glb', async () => {
    const html = new TextEncoder().encode('<!doctype html><title>x</title>');
    const message = await errorOf({ fetchBytes: async () => html });
    expect(message).toBe('test_room.glb is not a glTF binary (it does not start with "glTF")');
  });

  it('refuses a body shorter than the magic', async () => {
    expect(await errorOf({ fetchBytes: async () => new Uint8Array(2) })).toContain(
      'not a glTF binary',
    );
  });

  it('fails when the glb cannot be parsed', async () => {
    const message = await errorOf({
      parseModel: async () => {
        throw new Error('bad accessor');
      },
    });
    expect(message).toBe('cannot parse test_room.glb: bad accessor');
  });

  it('fails when the geometry cannot be loaded', async () => {
    const message = await errorOf({
      loadGeometryText: async () => {
        throw new Error('Failed to fetch dynamically imported module');
      },
    });
    expect(message).toContain('cannot load test_room.geometry.json');
  });

  it('fails on a geometry that breaks the schema, with the JSON path', async () => {
    const level = createTestLevelGeometry('test_room') as unknown as Record<string, unknown>;
    level.cellM = -1;
    const message = await errorOf({ loadGeometryText: async () => JSON.stringify(level) });
    expect(message).toContain('test_room.geometry.json is invalid');
    expect(message).toContain('cellM');
  });

  it('fails on geometry text that is not JSON', async () => {
    expect(await errorOf({ loadGeometryText: async () => '<html>' })).toContain('not valid JSON');
  });

  it('fails when the geometry belongs to another level', async () => {
    const message = await errorOf({ loadGeometryText: async () => geometryText('other_room') });
    expect(message).toContain('"other_room", expected "test_room"');
  });

  it('reports the glb before the geometry when both fail', async () => {
    const message = await errorOf({
      fetchBytes: async () => {
        throw new Error('offline');
      },
      loadGeometryText: async () => {
        throw new Error('offline');
      },
    });
    expect(message).toContain('test_room.glb');
  });

  it('logs one warn with the level id for a failure, and never throws', async () => {
    await errorOf({
      fetchBytes: async () => {
        throw new Error('offline');
      },
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.[0]).toBe('assets');
    expect(warnings[0]?.[2]).toMatchObject({ id: 'test_room' });
  });

  it('turns a throwing dependency into an error rather than a rejection', async () => {
    const result = await loadLevelAssets(
      'test_room',
      deps({
        fetchBytes: () => {
          throw new Error('sync throw');
        },
      }),
    );
    expect(result.ok).toBe(false);
  });
});

describe('fetchBytesWithTimeout', () => {
  /** A fetch that never answers on its own and rejects when its signal aborts, like the real one. */
  const stalledFetch = ((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    })) as typeof fetch;

  it('rejects with a timeout when the response never comes', async () => {
    await expect(fetchBytesWithTimeout('./x.glb', 10, stalledFetch)).rejects.toMatchObject({
      name: 'TimeoutError',
    });
  });

  it('turns that timeout into an assets error with the file name', async () => {
    const message = await errorOf({
      fetchBytes: (url) => fetchBytesWithTimeout(url, 10, stalledFetch),
    });
    expect(message).toContain('cannot fetch test_room.glb');
  });

  it('returns the bytes of a 2xx answer and rejects on any other status', async () => {
    const answer = (status: number) =>
      (async () => new Response(GLB, { status })) as unknown as typeof fetch;
    expect([...(await fetchBytesWithTimeout('./x.glb', 1000, answer(200)))]).toEqual([...GLB]);
    await expect(fetchBytesWithTimeout('./x.glb', 1000, answer(404))).rejects.toThrow('HTTP 404');
  });
});

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Lints a snippet as if it lived at `virtualPath`, in a scratch directory that holds a copy of
// biome.json, to prove that the config really enforces what CLAUDE.md claims. (`biome lint
// --stdin-file-path` does not report diagnostics, so real files are used.)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const biomeBin = join(repoRoot, 'node_modules', '.bin', 'biome');
let scratch = '';

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'pp-biome-'));
  const config = JSON.parse(readFileSync(join(repoRoot, 'biome.json'), 'utf8'));
  config.vcs = { enabled: false };
  writeFileSync(join(scratch, 'biome.json'), JSON.stringify(config));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function lint(virtualPath: string, code: string): { ok: boolean; output: string } {
  const file = join(scratch, virtualPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, code);
  const result = spawnSync(biomeBin, ['lint', virtualPath], { cwd: scratch, encoding: 'utf8' });
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}` };
}

const SHOULD_FAIL: { name: string; rule: string; path: string; code: string }[] = [
  {
    name: 'sim imports three',
    rule: 'noRestrictedImports',
    path: 'src/sim/x.ts',
    code: "import { Vector3 } from 'three';\nexport const v = Vector3;\n",
  },
  {
    name: 'sim imports three/examples',
    rule: 'noRestrictedImports',
    path: 'src/sim/x.ts',
    code: "import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';\nexport const l = GLTFLoader;\n",
  },
  {
    name: 'sim uses Date.now()',
    rule: 'noRestrictedGlobals',
    path: 'src/sim/x.ts',
    code: 'export const now = Date.now();\n',
  },
  {
    name: 'sim uses performance.now()',
    rule: 'noRestrictedGlobals',
    path: 'src/sim/x.ts',
    code: 'export const now = performance.now();\n',
  },
  {
    name: 'sim imports @shared/log',
    rule: 'noRestrictedImports',
    path: 'src/sim/x.ts',
    code: "import { log } from '@shared/log';\nexport const l = log;\n",
  },
  {
    name: 'sim (outside rapierPhysics) imports Rapier',
    rule: 'noRestrictedImports',
    path: 'src/sim/threats/x.ts',
    code: "import RAPIER from '@dimforge/rapier3d-deterministic-compat';\nexport const r = RAPIER;\n",
  },
  {
    name: 'client calls console.log',
    rule: 'noConsole',
    path: 'src/client/x.ts',
    code: "console.log('hi');\n",
  },
  {
    name: 'client imports @debug statically',
    rule: 'noRestrictedImports',
    path: 'src/client/x.ts',
    code: "import { overlay } from '@debug/overlay';\nexport const o = overlay;\n",
  },
  {
    name: 'client imports a deep debug path',
    rule: 'noRestrictedImports',
    path: 'src/client/x.ts',
    code: "import { panel } from '@debug/panels/feel';\nexport const p = panel;\n",
  },
  {
    name: 'client imports sim internals',
    rule: 'noRestrictedImports',
    path: 'src/client/x.ts',
    code: "import { world } from '@sim/world';\nexport const w = world;\n",
  },
  {
    name: 'shared imports client',
    rule: 'noRestrictedImports',
    path: 'src/shared/x.ts',
    code: "import { thing } from '@client/thing';\nexport const t = thing;\n",
  },
  {
    name: 'platform imports sim',
    rule: 'noRestrictedImports',
    path: 'src/platform/x.ts',
    code: "import { createSim } from '@sim';\nexport const c = createSim;\n",
  },
  {
    name: 'bots import client',
    rule: 'noRestrictedImports',
    path: 'src/bots/x.ts',
    code: "import { thing } from '@client/thing';\nexport const t = thing;\n",
  },
  {
    name: 'content imports three',
    rule: 'noRestrictedImports',
    path: 'src/content/x.ts',
    code: "import { Vector3 } from 'three';\nexport const v = Vector3;\n",
  },
  {
    name: 'sim uses window',
    rule: 'noRestrictedGlobals',
    path: 'src/sim/x.ts',
    code: 'export const w = window.innerWidth;\n',
  },
  {
    name: 'sim uses document',
    rule: 'noRestrictedGlobals',
    path: 'src/sim/x.ts',
    code: 'export const d = document.body;\n',
  },
  {
    name: 'sim uses setTimeout',
    rule: 'noRestrictedGlobals',
    path: 'src/sim/x.ts',
    code: 'export const t = setTimeout(() => {}, 1);\n',
  },
  {
    name: 'sim uses requestAnimationFrame',
    rule: 'noRestrictedGlobals',
    path: 'src/sim/x.ts',
    code: 'export const r = requestAnimationFrame(() => {});\n',
  },
  {
    name: 'sim uses localStorage',
    rule: 'noRestrictedGlobals',
    path: 'src/sim/x.ts',
    code: 'export const l = localStorage.getItem("x");\n',
  },
  {
    name: 'sim imports @shared/log with its extension',
    rule: 'noRestrictedImports',
    path: 'src/sim/x.ts',
    code: "import { thing } from '@shared/log.ts';\nexport const t = thing;\n",
  },
  {
    name: 'platform imports @debug',
    rule: 'noRestrictedImports',
    path: 'src/platform/x.ts',
    code: "import { thing } from '@debug/overlay';\nexport const t = thing;\n",
  },
  {
    name: 'platform imports bots',
    rule: 'noRestrictedImports',
    path: 'src/platform/x.ts',
    code: "import { thing } from '@bots/perfect';\nexport const t = thing;\n",
  },
  {
    name: 'platform imports content',
    rule: 'noRestrictedImports',
    path: 'src/platform/x.ts',
    code: "import { thing } from '@content/schema';\nexport const t = thing;\n",
  },
  {
    name: 'platform imports Rapier',
    rule: 'noRestrictedImports',
    path: 'src/platform/x.ts',
    code: "import { thing } from '@dimforge/rapier3d-deterministic-compat';\nexport const t = thing;\n",
  },
  {
    name: 'bots import content',
    rule: 'noRestrictedImports',
    path: 'src/bots/x.ts',
    code: "import { thing } from '@content/schema';\nexport const t = thing;\n",
  },
  {
    name: 'bots import Rapier',
    rule: 'noRestrictedImports',
    path: 'src/bots/x.ts',
    code: "import { thing } from '@dimforge/rapier3d-deterministic-compat';\nexport const t = thing;\n",
  },
  {
    name: 'bots import sim internals',
    rule: 'noRestrictedImports',
    path: 'src/bots/x.ts',
    code: "import { thing } from '@sim/world';\nexport const t = thing;\n",
  },
  {
    name: 'content imports @capacitor',
    rule: 'noRestrictedImports',
    path: 'src/content/x.ts',
    code: "import { thing } from '@capacitor/haptics';\nexport const t = thing;\n",
  },
  {
    name: 'content imports Rapier',
    rule: 'noRestrictedImports',
    path: 'src/content/x.ts',
    code: "import { thing } from '@dimforge/rapier3d-deterministic-compat';\nexport const t = thing;\n",
  },
  {
    name: 'content imports @debug',
    rule: 'noRestrictedImports',
    path: 'src/content/x.ts',
    code: "import { thing } from '@debug/overlay';\nexport const t = thing;\n",
  },
  {
    name: 'client imports Rapier',
    rule: 'noRestrictedImports',
    path: 'src/client/x.ts',
    code: "import { thing } from '@dimforge/rapier3d-deterministic-compat';\nexport const t = thing;\n",
  },
  {
    name: 'client imports bots statically',
    rule: 'noRestrictedImports',
    path: 'src/client/x.ts',
    code: "import { thing } from '@bots/perfect';\nexport const t = thing;\n",
  },
  {
    name: 'client/boot.ts imports Rapier',
    rule: 'noRestrictedImports',
    path: 'src/client/boot.ts',
    code: "import { thing } from '@dimforge/rapier3d-deterministic-compat';\nexport const t = thing;\n",
  },
  {
    name: 'entry file imports @debug',
    rule: 'noRestrictedImports',
    path: 'src/main.ts',
    code: "import { thing } from '@debug/overlay';\nexport const t = thing;\n",
  },
  {
    name: 'shared imports @debug',
    rule: 'noRestrictedImports',
    path: 'src/shared/x.ts',
    code: "import { thing } from '@debug/overlay';\nexport const t = thing;\n",
  },
  {
    name: 'shared/log.ts neighbour calls console',
    rule: 'noConsole',
    path: 'src/shared/other.ts',
    code: "console.info('x');\n",
  },
];

const SHOULD_PASS: { name: string; path: string; code: string }[] = [
  {
    name: 'shared/log.ts calls console.info',
    path: 'src/shared/log.ts',
    code: "console.info('x');\n",
  },
  {
    name: 'sim/physics/rapierPhysics.ts imports Rapier',
    path: 'src/sim/physics/rapierPhysics.ts',
    code: "import RAPIER from '@dimforge/rapier3d-deterministic-compat';\nexport const r = RAPIER;\n",
  },
  {
    name: 'client imports @sim',
    path: 'src/client/x.ts',
    code: "import { createSim } from '@sim';\nexport const c = createSim;\n",
  },
  {
    name: 'client imports three',
    path: 'src/client/x.ts',
    code: "import { Vector3 } from 'three';\nexport const v = Vector3;\n",
  },
  {
    name: 'client/boot.ts imports debug dynamically',
    path: 'src/client/boot.ts',
    code: "export const load = () => import('@debug/overlay');\n",
  },
  {
    name: 'shared test imports vitest',
    path: 'src/shared/x.test.ts',
    code: "import { expect, it } from 'vitest';\nit('works', () => expect(1).toBe(1));\n",
  },
  {
    name: 'client/boot.ts imports bots dynamically',
    path: 'src/client/boot.ts',
    code: "export const load = () => import('@bots/perfect');\n",
  },
  {
    name: 'entry file imports client and shared',
    path: 'src/main.ts',
    code: "import '@client/ui/styles/ui.css';\nimport { log } from '@shared/log';\nlog.info('boot', 'x');\n",
  },
  {
    name: 'platform imports capacitor and shared',
    path: 'src/platform/x.ts',
    code: "import { Haptics } from '@capacitor/haptics';\nimport { a } from '@shared/a';\nexport const h = [Haptics, a];\n",
  },
  {
    name: 'sim imports shared and content',
    path: 'src/sim/x.ts',
    code: "import { clamp } from '@shared/math';\nimport type { Feel } from '@content/schemas/feel';\nexport const c = [clamp, {} as Feel];\n",
  },
];

describe('biome boundaries', () => {
  for (const { name, rule, path, code } of SHOULD_FAIL) {
    it(`rejects: ${name}`, () => {
      const result = lint(path, code);
      expect(result.ok).toBe(false);
      expect(result.output).toContain(rule);
    });
  }

  for (const { name, path, code } of SHOULD_PASS) {
    it(`accepts: ${name}`, () => {
      const result = lint(path, code);
      expect(result.output).not.toContain('lint/');
      expect(result.ok).toBe(true);
    });
  }
});

import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/** The main checkout's e2e port. */
const MAIN_CHECKOUT_PORT = 5179;
/** A linked worktree's port is in `[WORKTREE_PORT_MIN, WORKTREE_PORT_MIN + WORKTREE_PORT_SPAN)`. */
const WORKTREE_PORT_MIN = 5180;
const WORKTREE_PORT_SPAN = 800;

/**
 * The port of the e2e dev server. Two stories tested at once (one git worktree each, see
 * CLAUDE.md › Git workflow) must never share it: with `reuseExistingServer`, the second run would
 * silently test the first one's code. So the main checkout keeps 5179 and a linked worktree (its
 * `.git` is a file) gets a port derived from its own path, stable from run to run.
 * `PP_E2E_PORT` overrides both.
 */
function e2ePort(): number {
  const forced = process.env.PP_E2E_PORT;
  if (forced !== undefined && forced !== '') {
    const port = Number(forced);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error(`PP_E2E_PORT must be an integer in [1024, 65535], got "${forced}"`);
    }
    return port;
  }
  const root = dirname(fileURLToPath(import.meta.url));
  const gitPath = `${root}/.git`;
  // No `.git` at all (an exported tree, a container without the repo) counts as the main checkout.
  const isLinkedWorktree = existsSync(gitPath) && statSync(gitPath).isFile();
  if (!isLinkedWorktree) return MAIN_CHECKOUT_PORT;
  const digest = createHash('sha256').update(root).digest();
  return WORKTREE_PORT_MIN + (digest.readUInt16BE(0) % WORKTREE_PORT_SPAN);
}

const PORT = e2ePort();
const landscapePhone = { viewport: { width: 844, height: 390 }, hasTouch: true };

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  // Screenshot references are per browser and per OS: `darwin` made on the Mac, `linux` made in
  // Docker for CI. The ratio is a guard against GPU dithering, never a slack for real changes: a
  // frame that needs more than 0.2 % is not deterministic, and that is the bug.
  snapshotPathTemplate:
    '{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixelRatio: 0.002,
    },
  },
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...landscapePhone } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], ...landscapePhone } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});

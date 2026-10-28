import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIST_PORT_OFFSET } from '../../../src/shared/constants.ts';

/** The main checkout's e2e port. */
const MAIN_CHECKOUT_PORT = 5179;
/** A linked worktree's port is in `[WORKTREE_PORT_MIN, WORKTREE_PORT_MIN + WORKTREE_PORT_SPAN)`. */
const WORKTREE_PORT_MIN = 5180;
const WORKTREE_PORT_SPAN = 800;

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function forcedPort(variable: string): number | null {
  const forced = process.env[variable];
  if (forced === undefined || forced === '') return null;
  const port = Number(forced);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${variable} must be an integer in [1024, 65535], got "${forced}"`);
  }
  return port;
}

/**
 * The port of the e2e dev server. Two stories tested at once (one git worktree each, see
 * CLAUDE.md › Git workflow) must never share it: with `reuseExistingServer`, the second run would
 * silently test the first one's code. So the main checkout keeps 5179 and a linked worktree (its
 * `.git` is a file) gets a port derived from its own path, stable from run to run.
 * `PP_E2E_PORT` overrides both.
 */
export function e2ePort(): number {
  const forced = forcedPort('PP_E2E_PORT');
  if (forced !== null) return forced;
  const gitPath = `${REPO_ROOT}/.git`;
  // No `.git` at all (an exported tree, a container without the repo) counts as the main checkout.
  const isLinkedWorktree = existsSync(gitPath) && statSync(gitPath).isFile();
  if (!isLinkedWorktree) return MAIN_CHECKOUT_PORT;
  const digest = createHash('sha256').update(REPO_ROOT).digest();
  return WORKTREE_PORT_MIN + (digest.readUInt16BE(0) % WORKTREE_PORT_SPAN);
}

/**
 * The port of the server that serves the built `dist/` for `npm run e2e:dist`: the dev port plus
 * `DIST_PORT_OFFSET`, so the dev and the dist servers of one checkout never collide, and two
 * checkouts stay apart. `PP_E2E_DIST_PORT` overrides it.
 */
export function e2eDistPort(): number {
  const forced = forcedPort('PP_E2E_DIST_PORT');
  if (forced !== null) return forced;
  return e2ePort() + DIST_PORT_OFFSET;
}

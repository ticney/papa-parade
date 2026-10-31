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

/**
 * The ports at and above 1024 that Chromium refuses to navigate to (`net::ERR_UNSAFE_PORT`; its
 * `kRestrictedPorts` in `net/base/port_util.cc`), WebKit's list being close to it. A server there
 * starts fine and every page load fails, which looks like a broken app: 6666 once did, for a
 * worktree whose path hashed to it.
 */
const BROWSER_BLOCKED_PORTS: ReadonlySet<number> = new Set([
  1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6679, 6697, 10080,
]);

/** True for a port a browser will not load a page from. */
export function isBrowserBlockedPort(port: number): boolean {
  return BROWSER_BLOCKED_PORTS.has(port);
}

/** `port`, or the next port up that a browser accepts. */
export function nextBrowserSafePort(port: number): number {
  let safe = port;
  while (isBrowserBlockedPort(safe)) safe++;
  return safe;
}

function forcedPort(variable: string): number | null {
  const forced = process.env[variable];
  if (forced === undefined || forced === '') return null;
  const port = Number(forced);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${variable} must be an integer in [1024, 65535], got "${forced}"`);
  }
  if (isBrowserBlockedPort(port)) {
    throw new Error(
      `${variable}=${port} is a port the browsers refuse (net::ERR_UNSAFE_PORT): pick another one`,
    );
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
  return worktreePortFor(digest.readUInt16BE(0));
}

/** The worktree port for a hash `hash16`: in the worktree range, and never a port a browser refuses. */
export function worktreePortFor(hash16: number): number {
  return nextBrowserSafePort(WORKTREE_PORT_MIN + (hash16 % WORKTREE_PORT_SPAN));
}

/**
 * The port of the server that serves the built `dist/` for `npm run e2e:dist`: the dev port plus
 * `DIST_PORT_OFFSET`, so the dev and the dist servers of one checkout never collide, and two
 * checkouts stay apart. `PP_E2E_DIST_PORT` overrides it.
 */
export function e2eDistPort(): number {
  const forced = forcedPort('PP_E2E_DIST_PORT');
  if (forced !== null) return forced;
  return distPortFor(e2ePort());
}

/**
 * The dist port for an e2e port: the dev port plus `DIST_PORT_OFFSET`. When that is a port a
 * browser refuses (the dev port 5666 gives 6666), the dev port plus twice the offset instead: a
 * range of its own (7180-7979 for the worktrees), so the fallback never lands on the regular dist
 * port of another worktree, as a step up to the next free port would.
 */
export function distPortFor(devPort: number): number {
  const regular = devPort + DIST_PORT_OFFSET;
  const port = isBrowserBlockedPort(regular)
    ? nextBrowserSafePort(devPort + 2 * DIST_PORT_OFFSET)
    : regular;
  if (port > 65535) {
    throw new Error(
      `the dist port (the e2e port ${devPort} + ${DIST_PORT_OFFSET}) is above 65535: set PP_E2E_DIST_PORT, or a lower PP_E2E_PORT`,
    );
  }
  return port;
}

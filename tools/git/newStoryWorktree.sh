#!/usr/bin/env bash
# Usage: npm run story:new -- <epic>-<story> [--skip-install]
#
# Gives a story its own git worktree, so that several agents can work on stories at once without
# sharing files (CLAUDE.md › Git workflow). The agents run it themselves at the start of
# create-story, dev-story and code-review, then enter the folder with `EnterWorktree`.
#
# The full key is looked up in sprint-status.yaml from its `<epic>-<story>` prefix (`2-3` →
# `2-3-sons-cultes-…`). If a worktree already has `story/<story-key>` checked out (the dev agent
# opened it, the review agent comes back to it), nothing is created: its path is printed.
# Otherwise `../papa-parade-<story-key>` is created on `story/<story-key>` (the existing branch, or
# a new one cut from `main`), and `npm ci` installs its own node_modules (never shared: two dev
# servers must not share Vite's cache). Its e2e port is derived from its path (playwright.config.ts).
#
# The last line of a successful run is always `WORKTREE=<absolute path>`.
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: npm run story:new -- <epic>-<story> [--skip-install]" >&2
  exit 1
fi
prefix=$1
skip_install=false
[ "${2:-}" = "--skip-install" ] && skip_install=true

# The main checkout is the first entry of `git worktree list`, whatever folder this runs from.
main_root=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
status_file="$main_root/_bmad-output/implementation-artifacts/sprint-status.yaml"

if ! printf '%s' "$prefix" | grep -Eq '^[0-9]+-[0-9]+$'; then
  echo "expected <epic>-<story>, like 2-3; got \"$prefix\"" >&2
  exit 1
fi
matches=$(grep -Eo "^  ${prefix}-[a-z0-9-]+:" "$status_file" | sed 's/^  //; s/:$//' || true)
count=$(printf '%s' "$matches" | grep -c . || true)
if [ "$count" -ne 1 ]; then
  echo "found $count stories starting with ${prefix}- in $status_file" >&2
  exit 1
fi
key=$matches
branch="story/$key"

# Already checked out somewhere (a worktree, or the main checkout itself): reuse it.
existing=$(git worktree list --porcelain | awk -v ref="branch refs/heads/$branch" '
  /^worktree / { path = substr($0, 10) }
  $0 == ref { print path; exit }')
if [ -n "$existing" ]; then
  echo "Story $key is already checked out in $existing."
  echo "WORKTREE=$existing"
  exit 0
fi

status=$(grep -E "^  ${key}:" "$status_file" | sed -E 's/^[^:]+:[[:space:]]*//; s/[[:space:]]*#.*$//')
if [ "$status" = "done" ]; then
  echo "story $key is already done" >&2
  exit 1
fi

dir="$(dirname "$main_root")/$(basename "$main_root")-$key"
if [ -e "$dir" ]; then
  echo "$dir exists but is not a worktree of $branch: look at it, then remove or rename it" >&2
  exit 1
fi

if git -C "$main_root" remote get-url origin >/dev/null 2>&1; then
  if git -C "$main_root" fetch --quiet origin main; then
    behind=$(git -C "$main_root" rev-list --count main..origin/main)
    if [ "$behind" -gt 0 ]; then
      echo "warning: local main is $behind commit(s) behind origin/main; pull it in $main_root first if the story needs them" >&2
    fi
  else
    echo "warning: could not fetch origin/main, using the local main" >&2
  fi
fi

if git -C "$main_root" show-ref --verify --quiet "refs/heads/$branch"; then
  git -C "$main_root" worktree add "$dir" "$branch"
else
  git -C "$main_root" worktree add -b "$branch" "$dir" main
fi

if [ "$skip_install" = false ]; then
  (cd "$dir" && npm ci --prefer-offline --no-audit --no-fund)
fi

echo "Story $key: $dir on $branch."
echo "WORKTREE=$dir"

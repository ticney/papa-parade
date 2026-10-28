#!/usr/bin/env bash
# Usage: npm run story:new -- <epic>-<story> [--skip-install]
#
# Opens a story in its own git worktree, so that several agents can develop stories at once
# without sharing files (CLAUDE.md › Git workflow): `../papa-parade-<story-key>` on the branch
# `story/<story-key>`, cut from `main`. The full key is looked up in sprint-status.yaml from its
# `<epic>-<story>` prefix (`2-3` → `2-3-sons-cultes-…`). An existing branch is reused. Then
# `npm ci` installs this worktree's own node_modules (never shared: two dev servers must not share
# a Vite cache). Its e2e port is derived from its path (playwright.config.ts).
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: npm run story:new -- <epic>-<story> [--skip-install]" >&2
  exit 1
fi
prefix=$1
skip_install=false
[ "${2:-}" = "--skip-install" ] && skip_install=true

root=$(git rev-parse --show-toplevel)
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
status=$(grep -E "^  ${key}:" "$status_file" | sed -E 's/^[^:]+:[[:space:]]*//; s/[[:space:]]*#.*$//')
if [ "$status" = "done" ]; then
  echo "story $key is already done" >&2
  exit 1
fi
branch="story/$key"
dir="$(dirname "$main_root")/$(basename "$main_root")-$key"

if [ -e "$dir" ]; then
  echo "$dir already exists: cd there to work on $key" >&2
  exit 1
fi

if git -C "$main_root" remote get-url origin >/dev/null 2>&1; then
  if git -C "$main_root" fetch --quiet origin main; then
    behind=$(git -C "$main_root" rev-list --count main..origin/main)
    [ "$behind" -gt 0 ] && echo "warning: local main is $behind commit(s) behind origin/main; pull it in $main_root first if the story needs them" >&2
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

echo
echo "Story $key: $dir on $branch."
echo "Next: cd \"$dir\" && claude, then /gds-create-story $prefix (if not created yet), /gds-dev-story, /gds-code-review."

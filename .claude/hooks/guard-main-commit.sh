#!/usr/bin/env bash
# PreToolUse (Bash) guard: an agent may not commit code on `main`.
# Story work happens on `story/<story-key>` and reaches `main` only through
# `git merge --no-ff` after Geo's OK (see CLAUDE.md › Git workflow).
# On `main`, a commit may only touch `_bmad-output/` (planning docs). Concluding
# a merge (MERGE_HEAD present) is allowed. Exit 2 blocks the tool call.
set -u
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')

# Only `git … commit …` commands.
printf '%s' "$cmd" | grep -Eq '(^|[;&|(]|[[:space:]])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-;&|[:space:]][^[:space:]]*)?)*[[:space:]]+commit([[:space:]]|$)' || exit 0

dir=${cwd:-$PWD}
cdir=$(printf '%s' "$cmd" | sed -nE 's/.*git[[:space:]]+-C[[:space:]]+([^[:space:]]+).*/\1/p' | head -n1)
if [ -n "$cdir" ]; then
  case "$cdir" in /*) dir=$cdir ;; *) dir="$dir/$cdir" ;; esac
fi
git -C "$dir" rev-parse --git-dir >/dev/null 2>&1 || exit 0

branch=$(git -C "$dir" symbolic-ref --short -q HEAD || true)
[ "$branch" = "main" ] || exit 0
[ -f "$(git -C "$dir" rev-parse --git-path MERGE_HEAD)" ] && exit 0

files=$(git -C "$dir" diff --cached --name-only)
# `-a` / `--all`, or a `git add` in the same command: count every pending change.
if printf '%s' "$cmd" | grep -Eq '(^|[[:space:]])(-[a-zA-Z]*a[a-zA-Z]*|--all)([[:space:]]|$)|git[[:space:]]+add'; then
  files=$(printf '%s\n%s' "$files" "$(git -C "$dir" status --porcelain | cut -c4- | sed 's/.* -> //')")
fi

outside=$(printf '%s\n' "$files" | grep -v '^$' | grep -v '^_bmad-output/' | sort -u)
[ -z "$outside" ] && exit 0

{
  echo "Blocked: no code commit on main. Work on a story branch: git switch -c story/<story-key> (or git switch story/<story-key>)."
  echo "Merge it into main with git merge --no-ff after Geo's OK. Files outside _bmad-output/:"
  printf '%s\n' "$outside" | sed 's/^/  /'
} >&2
exit 2

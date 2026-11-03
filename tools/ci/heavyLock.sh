#!/usr/bin/env bash
# Usage: bash tools/ci/heavyLock.sh <command> [args…]
#
# Runs a heavy check (an e2e suite, `ci`) only when no other one is running on this machine, so that
# two agents working on two stories at once do not load the Mac with two Playwright suites and make
# each other time out (CLAUDE.md › Which check, when). The npm scripts `e2e`, `e2e:dist`, `ci:story`
# and `ci` go through it; `ci:fast` does not (a few seconds).
#
# The lock is the folder `pp-heavy.lock` in the git common dir, the same `.git` for the main checkout
# and every worktree. `mkdir` is atomic (macOS has no `flock`). Its `owner` file names the holder: a
# waiter prints who it waits for every 30 s and tries again every 5 s; there is no queue order. A lock
# whose holder is gone (killed, crashed, the Mac restarted) is taken over with a warning: its pid is
# dead, or now belongs to another process (a different start time).
#
# A command run under the lock inherits `PP_HEAVY_LOCK_HELD`, so `ci` calling `npm run e2e` does not
# wait for itself. On macOS the holder keeps the Mac awake (`caffeinate -i -s`) until it exits: an
# idle Mac sleeps after a minute and a sleeping run fails like a loaded one.
#
# `PP_LOCK_WAIT_MAX_S` (default 2700, 45 min) caps the wait; past it the script fails (exit 75).
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: bash tools/ci/heavyLock.sh <command> [args…]" >&2
  exit 1
fi

lock="$(git rev-parse --path-format=absolute --git-common-dir)/pp-heavy.lock"
breaker="$lock.break"

if [ "${PP_HEAVY_LOCK_HELD:-}" = "$lock" ]; then
  exec "$@"
fi

wait_max_s=${PP_LOCK_WAIT_MAX_S:-2700}
poll_s=5
note_every_s=30

# Both print nothing (and succeed) when the process or the file is gone.
started_of() { ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//; s/ *$//' || true; }
field() { sed -n "s/^$1=//p" "$lock/owner" 2>/dev/null | head -n1 || true; }

# Prints why the lock is stale, or nothing while its holder is alive (or still writing `owner`).
stale_reason() {
  local pid started
  pid=$(field pid)
  if [ -z "$pid" ]; then
    # `owner` is written right after `mkdir`; a minute without it means the holder died in between.
    [ -n "$(find "$lock" -maxdepth 0 -mmin +1 2>/dev/null)" ] && echo "it has no owner file"
    return 0
  fi
  started=$(started_of "$pid")
  if [ -z "$started" ]; then
    echo "pid $pid is gone"
  elif [ "$started" != "$(field started)" ]; then
    echo "pid $pid is now another process"
  fi
}

# Removes a stale lock. `$breaker` makes two waiters that find the same stale lock take turns, and
# the reason is checked again under it: the other waiter may have removed it and taken a fresh one.
break_stale() {
  if ! mkdir "$breaker" 2>/dev/null; then
    [ -n "$(find "$breaker" -maxdepth 0 -mmin +1 2>/dev/null)" ] && rmdir "$breaker" 2>/dev/null
    return 0
  fi
  local reason
  reason=$(stale_reason)
  if [ -n "$reason" ]; then
    echo "heavy-lock: warning: taking over a stale lock ($reason; it was: $(field label) in $(field worktree))" >&2
    rm -rf "$lock"
  fi
  rmdir "$breaker"
}

label="$*"
worktree=$(basename "$(git rev-parse --show-toplevel)")
waited_s=0
next_note_s=0
while ! mkdir "$lock" 2>/dev/null; do
  if [ -n "$(stale_reason)" ]; then
    break_stale
    continue
  fi
  if [ "$waited_s" -ge "$wait_max_s" ]; then
    echo "heavy-lock: gave up after ${waited_s} s waiting for $(field label) in $(field worktree) (pid $(field pid)); rerun when it is done" >&2
    exit 75
  fi
  if [ "$waited_s" -ge "$next_note_s" ]; then
    now=$(date +%s)
    since=$(field since)
    running_min=$(((now - ${since:-$now}) / 60))
    echo "heavy-lock: waiting for $(field label) in $(field worktree) (pid $(field pid), running for ${running_min} min) before $label" >&2
    next_note_s=$((waited_s + note_every_s))
  fi
  sleep "$poll_s"
  waited_s=$((waited_s + poll_s))
done

child=
release() {
  [ "$(field pid)" = "$$" ] && rm -rf "$lock"
  return 0
}
on_signal() {
  [ -n "$child" ] && kill -TERM "$child" 2>/dev/null && wait "$child" 2>/dev/null
  exit "$1"
}
trap release EXIT
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

printf 'pid=%s\nstarted=%s\nsince=%s\nworktree=%s\nlabel=%s\n' \
  "$$" "$(started_of $$)" "$(date +%s)" "$worktree" "$label" >"$lock/owner.tmp"
mv "$lock/owner.tmp" "$lock/owner"
[ "$waited_s" -gt 0 ] && echo "heavy-lock: lock taken after ${waited_s} s, running $label" >&2

if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -i -s -w "$$" </dev/null >/dev/null 2>&1 &
fi

# In the background, so that a signal reaches the trap now rather than when the command ends.
export PP_HEAVY_LOCK_HELD="$lock"
"$@" &
child=$!
status=0
wait "$child" || status=$?
exit "$status"

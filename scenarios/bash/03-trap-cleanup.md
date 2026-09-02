# The script that leaks a lock file forever

## Briefing

A sync job runs every fifteen minutes from cron. It uses a lock file so two copies
cannot run at once, and a temporary directory for working data.

Last night the source API returned a 500. The script exited on the error, as it
should — and left the lock file behind. Since then every scheduled run has found the
lock, concluded another instance is running, and exited without doing anything. The
job has been dead for fourteen hours and reported nothing.

The temporary directories are still there too. There are now several hundred of them
in `/tmp`, one per failed run over the past months.

## Your Task

Save the script and make it safe to run unattended.

1. Reproduce the leak: run it, force a failure, and confirm the lock survives.
2. Confirm that every subsequent run is now blocked.
3. Fix it so that the lock and the temp directory are released on **every** exit path
   — success, error, and being killed.
4. Make the locking robust against a genuinely crashed process, not just a
   gracefully-failed one.

```bash
mkdir -p ~/breakfix/bash-03 && cd ~/breakfix/bash-03
```

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail

rm -rf lab && mkdir lab && cd lab
mkdir -p data

# stand-in for the remote API; controlled by the FAIL_MODE env var
cat > fetch-data.sh <<'EOF'
#!/usr/bin/env bash
case "${FAIL_MODE:-none}" in
  error) echo "HTTP 500 from upstream" >&2; exit 1 ;;
  hang)  sleep 600 ;;
esac
echo "record-1"
echo "record-2"
EOF
chmod +x fetch-data.sh

echo "sandbox ready in $(pwd)"
```

### file: sync.sh

```bash
#!/usr/bin/env bash
set -euo pipefail

LOCK="/tmp/sync.lock"
WORKDIR="/tmp/sync-work-$$"

if [ -f "$LOCK" ]; then
  echo "another sync is already running (lock: $LOCK)"
  exit 0
fi

touch "$LOCK"
mkdir -p "$WORKDIR"

echo "syncing into $WORKDIR"

./fetch-data.sh > "$WORKDIR/raw.txt"

wc -l < "$WORKDIR/raw.txt" | xargs -I{} echo "fetched {} records"
cp "$WORKDIR/raw.txt" data/latest.txt

rm -rf "$WORKDIR"
rm -f "$LOCK"

echo "sync complete"
```

## Expected Failure

A normal run works and cleans up:

```bash
bash setup.sh
cd lab
cp ../sync.sh .
bash sync.sh; echo "exit=$?"
# syncing into /tmp/sync-work-12345
# fetched 2 records
# sync complete
# exit=0
```

Now make the upstream fail, exactly as it did last night:

```bash
FAIL_MODE=error bash sync.sh; echo "exit=$?"
```

```
syncing into /tmp/sync-work-12346
HTTP 500 from upstream
exit=1
```

The script exited on the error and never reached its cleanup lines:

```bash
ls -l /tmp/sync.lock
# -rw-r--r-- 1 you you 0 ... /tmp/sync.lock

ls -d /tmp/sync-work-*
# /tmp/sync-work-12346
```

And now the job is permanently wedged. Every future run, including healthy ones:

```bash
bash sync.sh; echo "exit=$?"
# another sync is already running (lock: /tmp/sync.lock)
# exit=0
```

Note the exit code. It reports **success** while doing nothing, so cron is happy and
no monitoring notices. That is why it went fourteen hours.

Interrupting the script has the same effect:

```bash
rm -f /tmp/sync.lock
FAIL_MODE=hang bash sync.sh &
sleep 2; kill %1
ls -l /tmp/sync.lock          # still there
```

## Expected Outcome

Cleanup must happen on every exit path.

A failing run leaves nothing behind:

```bash
rm -f /tmp/sync.lock; rm -rf /tmp/sync-work-*
FAIL_MODE=error bash sync.sh; echo "exit=$?"
# error: fetch failed
# exit=1

ls /tmp/sync.lock 2>/dev/null || echo "lock released"
ls -d /tmp/sync-work-* 2>/dev/null || echo "no temp dirs"
```

Both must print their "clean" message.

A killed run also cleans up:

```bash
FAIL_MODE=hang bash sync.sh &
sleep 2; kill %1; sleep 1
ls /tmp/sync.lock 2>/dev/null || echo "lock released after SIGTERM"
ls -d /tmp/sync-work-* 2>/dev/null || echo "no temp dirs after SIGTERM"
```

A stale lock from a process that no longer exists does not block a new run:

```bash
# simulate a crashed instance
echo 999999 > /tmp/sync.lock          # a PID that does not exist
bash sync.sh; echo "exit=$?"
# should detect the stale lock, take it over, and complete
# exit=0
```

Genuine concurrency is still prevented:

```bash
rm -f /tmp/sync.lock
FAIL_MODE=hang bash sync.sh & sleep 1
bash sync.sh; echo "exit=$?"
# error: another sync is already running (pid NNNN)
# exit=75
kill %1
```

The blocked run must exit **non-zero** so that monitoring can see it.

And a successful run still does the work:

```bash
rm -f /tmp/sync.lock
bash sync.sh && cat data/latest.txt
# record-1
# record-2
```

## Hints

### Hint 1 — trap runs your cleanup no matter how the script ends

```bash
cleanup() {
  rm -rf "$WORKDIR"
  rm -f "$LOCK"
}
trap cleanup EXIT
```

`trap ... EXIT` fires when the script exits for any reason: normal completion,
`exit`, an error under `set -e`, or an uncaught signal that terminates it. Register
it **immediately after** creating the resource, not at the end of the script — the
window between creating and registering is exactly where the leak lives.

Add `trap cleanup INT TERM` as well if you want a specific exit code for signals;
otherwise `EXIT` alone covers the common cases.

### Hint 2 — mktemp, not $$

`/tmp/sync-work-$$` uses the process ID, which is predictable and gets reused after a
reboot. If an attacker can create `/tmp/sync-work-1234` first, as a symlink pointing
somewhere else, your script writes through it.

```bash
WORKDIR="$(mktemp -d)"
```

`mktemp -d` creates the directory atomically with mode 700 and a random name. It is
one word shorter and removes an entire vulnerability class.

### Hint 3 — A lock file is not a lock

`[ -f "$LOCK" ]` then `touch "$LOCK"` is two operations. Two processes can both pass
the test before either creates the file, and both proceed. The window is small and it
will find you eventually.

Use a mechanism that tests and acquires atomically. `flock` is the standard answer on
Linux:

```bash
exec 9>"$LOCK"
flock -n 9 || { echo "already running" >&2; exit 75; }
```

The lock is held on the file descriptor and released automatically when the process
exits — including if it is killed with `SIGKILL`, which no trap can catch. That is
the property that makes stale locks impossible.

If you must stay with a lock file, `mkdir` is atomic where `touch` is not, and writing
the PID lets a later run check whether the owner is still alive with `kill -0`.

### Hint 4 — Exiting 0 when you did nothing is the real incident

The script exits `0` when it finds the lock, so cron and any monitoring see a
successful run. Fourteen hours of doing nothing looked identical to fourteen hours of
working correctly.

Use a distinct non-zero code. `75` is `EX_TEMPFAIL` from `sysexits.h` and conventionally
means "temporary failure, try again later" — it lets a wrapper distinguish "blocked"
from "broken".

### Hint 5 — Make cleanup idempotent

Your cleanup function may run when only some resources exist, so it must tolerate
that. `rm -f` and `rm -rf` do not error on a missing path; guard anything else with a
`[[ -n "$VAR" ]]` test. And never `rm -rf "$WORKDIR"` without confirming the variable
is non-empty — an unset variable there is a catastrophe.

## Solution

Two design faults: cleanup was written as ordinary statements that any early exit
skips, and the lock was implemented with a non-atomic test that cannot detect a dead
owner.

```bash
#!/usr/bin/env bash
# Sync upstream data. Safe to run from cron: single-instance, self-cleaning.
set -euo pipefail

LOCK="/tmp/sync.lock"
WORKDIR=""

cleanup() {
  local status=$?
  [[ -n "$WORKDIR" && -d "$WORKDIR" ]] && rm -rf "$WORKDIR"
  return $status
}
trap cleanup EXIT

# --- acquire the lock atomically -------------------------------------------
# fd 9 stays open for the life of the process; the kernel releases the lock
# when the process dies, however it dies. No stale locks are possible.
exec 9>"$LOCK"
if ! flock -n 9; then
  owner="$(cat "$LOCK" 2>/dev/null || echo unknown)"
  echo "error: another sync is already running (pid $owner)" >&2
  exit 75          # EX_TEMPFAIL: blocked, not broken
fi
echo $$ >&9

# --- do the work -----------------------------------------------------------
WORKDIR="$(mktemp -d)"
echo "syncing into $WORKDIR"

if ! ./fetch-data.sh > "$WORKDIR/raw.txt"; then
  echo "error: fetch failed" >&2
  exit 1
fi

records="$(wc -l < "$WORKDIR/raw.txt")"
echo "fetched $records records"

if (( records == 0 )); then
  echo "error: upstream returned no records; refusing to overwrite data/latest.txt" >&2
  exit 1
fi

# write to a temp file in the destination, then rename: readers never see a
# half-written file, because rename within a filesystem is atomic
cp "$WORKDIR/raw.txt" data/.latest.txt.tmp
mv data/.latest.txt.tmp data/latest.txt

echo "sync complete"
```

Work through the verification list:

```bash
rm -f /tmp/sync.lock; rm -rf /tmp/sync-work-*
FAIL_MODE=error bash sync.sh; echo "exit=$?"
ls -d /tmp/sync-work-* 2>/dev/null || echo "no temp dirs"

FAIL_MODE=hang bash sync.sh & sleep 1; bash sync.sh; echo "blocked exit=$?"
kill %1
```

Why `flock` rather than a PID file, since both appear in real codebases: a PID file
requires you to decide whether a recorded PID is still alive, and `kill -0` cannot
tell you whether that PID is *your* process or an unrelated one that reused the
number. `flock` delegates the whole problem to the kernel, which releases the lock
when the file descriptor closes — and file descriptors close on `SIGKILL`, on a
segfault, and on the OOM killer, none of which run any trap you could write.

The `.tmp` file plus `mv` is a second habit worth taking away. `cp` directly onto
`data/latest.txt` means a reader can observe a partially written file, and a crash
mid-copy leaves the destination truncated. Rename within the same filesystem is
atomic, so readers see either the old file or the new one.

Note also the empty-result guard. The original would have happily overwritten good
data with an empty file if upstream returned nothing successfully — a failure mode
that is quieter and more damaging than the 500 that started this.

## What You Learned

The script had cleanup code. It simply lived on the one path the failure did not
take, which is the normal way resource leaks happen: someone writes the happy path,
tests the happy path, and the error path is exercised for the first time in
production at 2 a.m.

`trap ... EXIT` is the answer for anything a script creates and must remove, and it
belongs on the line immediately after the resource is created. The wider point is
about failure modes: this outage was not caused by the upstream 500, it was caused by
the script's inability to recover from one. Ask of anything you schedule — if this
dies right here, what does the next run find?

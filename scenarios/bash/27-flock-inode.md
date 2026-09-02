# flock: the lock that did not lock

## Briefing

Two cron jobs overlap. You added `flock -n /tmp/job.lock $0` but they still both
run: the lock file is on NFS without lock support, or you lock a file you
`rm` every run (the lock is the inode), or you run `flock cmd` without `exec`
and the wrapper exits, releasing the lock while children continue. The beginner
trap-cleanup drill used a lock *file existence* test (TOCTOU). `flock` is the
real primitive — when used on a stable local inode.

## Your Task

- Show two processes holding a naive `mkdir` lock or a deleted flock file.
- Use `flock` on an fd that stays open for the job lifetime.
- Fail fast with `flock -n` when the job is already running.

## Starter Files

### file: job.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
LOCK=/tmp/job.lock
rm -f "$LOCK"            # "clean up" — also drops the inode you might lock
flock -n "$LOCK" sleep 30
echo "got lock pid=$$"
sleep 10
```

## Expected Failure

```bash
bash job.sh &
bash job.sh &
# both may print "got lock" if rm -f raced, or flock locks a new file each time
```

`rm -f "$LOCK"` before `flock` means each process may create a different inode.
Locking by path follows the inode at open time; deleting the name does not
invalidate an fd lock, but the *next* process opens a new file — two locks.

## Expected Outcome

The second instance exits immediately; the first holds the fd until it finishes.

```bash
bash job.sh &
sleep 1
bash job.sh
# [exits 1]  flock: ...
```

`ls -l /var/lock/job.lock` exists for the whole run; no `rm` at start.

## Hints

### Hint 1 — Lock the fd, not the name

```bash
exec 9>/var/lock/job.lock
flock -n 9 || exit 0
# fd 9 held until process exits
```

Do not unlink the lock at the start. Unlinking at the end is optional; the fd
is the lock.

### Hint 2 — NFS

`flock` on NFS is historically unreliable (implementation-dependent). Use a
local disk (`/var/lock`) or `lockfile`/`mkdir` on NFS with documented caveats.
`flock` across containers needs a shared lock filesystem that supports it.

## Solution

```bash
#!/usr/bin/env bash
set -euo pipefail
mkdir -p /var/lock
exec 9>/var/lock/job.lock
if ! flock -n 9; then
  echo "already running" >&2
  exit 0
fi
# work
sleep 10
```

- **`flock FILE cmd`** holds the lock only while `cmd` runs — good. **`rm` the
  file in `cmd`** is still wrong.
- **`flock -w 10`** waits up to 10s instead of `-n` fail-now — pick for cron vs
  interactive.
- **Exit 0 when skipped** so cron does not page you for overlap; log that you
  skipped.
- **This replaces PID-file locks** that cannot tell a dead process (the trap
  drill's "robust against crash" part). Kernel drops flock on death.

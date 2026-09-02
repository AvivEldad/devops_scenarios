# The process that ignores your kill

## Briefing

You `kill` a process and it stays. You `kill` it again — still there. It is either catching
and ignoring the signal, taking a long time to shut down, or wedged in a state where signals
cannot reach it. Reflexively reaching for `kill -9` can lose data or leave corruption.

`kill` sends a signal, and processes handle signals differently: `SIGTERM` (the default)
asks politely and can be caught, blocked, or ignored; `SIGKILL` (-9) cannot be caught but
gives no chance to clean up; and a process in uninterruptible sleep (`D` state) will not
respond to any signal until its I/O completes.

## Your Task

- Start a process that ignores `SIGTERM` and observe that `kill` seems to do nothing.
- Determine whether it is ignoring the signal, shutting down slowly, or stuck in `D` state.
- Stop it correctly, escalating only as needed and understanding the cost.

## Starter Files

### file: stubborn.sh

```bash
#!/usr/bin/env bash
# Traps SIGTERM and refuses to exit on it (simulates an app that mishandles shutdown).
trap 'echo "got SIGTERM, ignoring it"' TERM
echo "stubborn PID: $$"
while true; do sleep 1; done
```

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
chmod +x stubborn.sh
./stubborn.sh &
echo "started; try: kill <pid>   (it will ignore SIGTERM)"
```

## Expected Failure

```bash
bash setup.sh
# stubborn PID: 4821
kill 4821
# got SIGTERM, ignoring it        <- caught and ignored
ps -p 4821 >/dev/null && echo "still alive"
# still alive
```

```bash
# check the process state and which signals it blocks/ignores:
ps -o pid,stat,comm -p 4821
#   PID STAT COMMAND
#  4821 S    stubborn.sh          <- S = interruptible sleep (signals CAN be delivered)
cat /proc/4821/status | grep -E 'SigIgn|SigCgt'
# SigCgt: 0000000000004000        <- it has a handler for SIGTERM (bit 15)
```

The process installed a `SIGTERM` handler that does not exit, so the default polite request
is ignored. `SigCgt` (caught signals) confirms it is handling TERM. This is different from a
process stuck in `D` state, which ignores signals for a different reason (pending I/O).

## Expected Outcome

The process is stopped by the least forceful means that works.

If it merely mishandles TERM, a stronger-but-still-catchable signal or SIGKILL stops it:

```bash
kill -TERM 4821 ; sleep 3
kill -KILL 4821                 # last resort; uncatchable
ps -p 4821 || echo "gone"
# gone
```

You can tell `D`-state (unkillable until I/O finishes) apart from ignored-signal:

```bash
ps -o pid,stat,wchan -p <pid>
# STAT 'D' + a wchan in the kernel = uninterruptible; even -9 will not work until I/O completes
```

## Hints

### Hint 1 — Signals differ; check what the process does with them

`kill <pid>` sends `SIGTERM`, which a process can catch/ignore. `/proc/<pid>/status` shows
`SigIgn` (ignored) and `SigCgt` (caught) bitmasks. If TERM is caught and the app does not
exit, that is an application bug — try its documented shutdown signal, or escalate. `kill -l`
lists signal names/numbers.

### Hint 2 — Distinguish "ignoring" from "uninterruptible"

`ps -o stat` state matters: `S`/`R` = signals are delivered (an unresponsive process is
ignoring or slow); `D` = uninterruptible sleep, blocked on I/O (NFS hang, dying disk) — no
signal, not even `SIGKILL`, works until the I/O returns. For `D` state, fix the I/O (e.g.
the stuck mount), do not keep sending signals. `SIGKILL` is the last resort and forfeits
cleanup.

## Solution

Identify why the kill was ignored, then stop it appropriately.

```bash
# 1) is it catching TERM, or is it in D state?
ps -o pid,stat,wchan,comm -p <pid>
grep -E 'SigIgn|SigCgt' /proc/<pid>/status

# 2a) app mishandles TERM (state S/R): try its real shutdown signal, then escalate
kill -TERM <pid>; sleep 3
kill -KILL <pid>                 # uncatchable last resort (no cleanup)

# 2b) D state (uninterruptible): signals will NOT work; fix the underlying I/O
#     e.g. recover/umount the hung NFS mount; the process exits once I/O completes or errors
```

- **`kill` sends a signal; it does not force-stop.** The default `SIGTERM` is a request that
  a process may catch, block, or ignore. "kill did nothing" usually means the app handled TERM
  and chose not to exit — an application behaviour, not a kill failure.
- **`SIGKILL` (-9) cannot be caught but forfeits cleanup** — no flushing buffers, releasing
  locks, or graceful connection drain. Use it as a last resort; a database `kill -9` can mean
  recovery on next start.
- **`/proc/<pid>/status` SigCgt/SigIgn** reveal which signals the process handles or ignores,
  turning "why won't it die?" into a definite answer.
- **`D` (uninterruptible sleep) ignores every signal, including SIGKILL**, until its I/O
  completes. The fix is the I/O (a hung NFS mount, a failing disk), not more signals — pounding
  `-9` on a D-state process accomplishes nothing.
- **Prefer the documented shutdown path.** Many services define a specific signal or command
  for graceful stop; use it (or systemd's `stop`, which sends TERM then KILL after a timeout)
  before escalating.

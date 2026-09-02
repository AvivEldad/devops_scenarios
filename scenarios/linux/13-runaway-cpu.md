# The process pinning a core at 100% CPU

## Briefing

A server is sluggish and its fans are loud. Something is burning a whole CPU core, but you
do not know what, or a process you can see is not obviously the culprit. You need to find
it, understand it, and deal with it without guessing.

Finding a runaway process is a repeatable procedure: identify the top CPU consumer, inspect
what it is actually doing, then decide between renicing, signalling, or killing it — in that
order of least to most disruptive.

## Your Task

- Start a CPU-burning process and locate it from a cold start (as if you found the box
  loaded).
- Identify the exact process, its command line, and what it is doing.
- Reduce its impact with the least disruptive tool that works.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
# a runaway busy-loop, backgrounded, with an innocuous-looking name
cat > worker.sh <<'EOF'
#!/usr/bin/env bash
while :; do :; done      # spin, consuming a full core
EOF
chmod +x worker.sh
setsid ./worker.sh &      # detach so it looks like a stray background job
echo "started runaway worker; find it with top/ps, do NOT rely on this PID: $!"
```

## Expected Failure

```bash
bash setup.sh
uptime
# load average: 1.98, 1.20, 0.65     <- climbing on an otherwise idle box

top -b -n1 | head -12
# %Cpu(s): 100.0 us     <- a core saturated in user space
#   PID USER  ... %CPU  COMMAND
#  4821 you   ... 99.7  worker.sh
```

The load average is rising and one core is at 100% user time. `top` shows the PID and
command, but you should confirm what it really is (full command line, parent, how long it
has run) before acting.

## Expected Outcome

The culprit is identified precisely and its impact is contained.

You know exactly which process and command:

```bash
ps -o pid,ppid,etime,pcpu,args -p 4821
#   PID  PPID     ELAPSED %CPU COMMAND
#  4821     1       02:13 99.7 /bin/bash ./worker.sh
```

CPU pressure drops after you act (renice, or stop it):

```bash
top -b -n1 | head -5
# %Cpu(s) user time back to low single digits after renice/stop
```

If it should not be running at all, it is gone:

```bash
kill 4821          # SIGTERM first
ps -p 4821 || echo "gone"
```

## Hints

### Hint 1 — Find the consumer, then identify it

`top` (press `P` to sort by CPU) or `ps -eo pid,ppid,pcpu,etime,args --sort=-pcpu | head`
finds the top consumer. Then *identify* it properly: full `args`, parent (`ppid`), how long
it has run (`etime`), and what it is doing (`cat /proc/<pid>/status`, or `strace -p <pid>`
briefly). Do not kill on the strength of a name alone.

### Hint 2 — Least-disruptive tool first

If the process is legitimate but greedy, `renice +10 -p <pid>` lowers its priority so it
yields to others, and `cpulimit`/cgroups can cap it. If it is stuck, `kill <pid>` (SIGTERM)
asks it to stop cleanly; `kill -9` (SIGKILL) is the last resort that gives it no chance to
clean up. Escalate only as needed.

## Solution

Locate the top CPU process, confirm what it is, then contain it with the gentlest effective
action.

```bash
# 1) find it
ps -eo pid,ppid,pcpu,etime,args --sort=-pcpu | head -5

# 2) identify it
PID=$(ps -eo pid,args --sort=-pcpu | awk 'NR==2{print $1}')
ps -o pid,ppid,etime,pcpu,args -p "$PID"

# 3a) legitimate but greedy -> lower priority (least disruptive)
renice +10 -p "$PID"

# 3b) not needed -> stop it cleanly, escalate only if it ignores TERM
kill "$PID"
sleep 2; kill -0 "$PID" 2>/dev/null && kill -9 "$PID"
```

- **Load average is work waiting, not just CPU%.** A rising load with 100% user time points
  to CPU-bound work; a rising load with low CPU points elsewhere (I/O wait). Read both
  together.
- **Find, then identify, then act.** `top`/`ps --sort=-pcpu` finds the consumer; `args`,
  `ppid`, `etime` and `/proc/<pid>` identify it. Acting on a name alone gets the wrong process
  eventually.
- **Escalate disruption deliberately**: `renice` (keep it running, lower priority) →
  `cpulimit`/cgroup cap → `kill` (SIGTERM, clean stop) → `kill -9` (SIGKILL, forced). Reach
  for the softest tool that solves the problem.
- **`/proc/<pid>/` is the source of truth** — `cmdline`, `status`, `fd/`, `cwd` tell you what
  the process is and what it is touching, more reliably than a truncated `top` column.
- **The durable fix is usually upstream**: a bug causing a busy-loop, a missing sleep in a
  poller, or unbounded work. Containing it buys time; fixing the code stops the recurrence.

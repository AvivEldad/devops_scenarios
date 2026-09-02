# The server that looks out of memory but is not

## Briefing

Monitoring is paging: `free -m` shows almost no free memory, someone is about to add RAM or
restart services in a panic. But the applications are fine and nothing is being OOM-killed.
The memory is not lost — it is being used as cache, exactly as intended.

Linux uses otherwise-free RAM as page cache to speed up disk access, and reports it as
"used". That cache is instantly reclaimable when a process needs memory. The number that
actually matters is **available** memory, not **free** memory.

## Your Task

- Reproduce the "almost no free memory" reading and show the system is healthy.
- Explain the difference between `free`, `used`, `buff/cache`, and `available`.
- Determine whether there is real memory pressure or just healthy caching.

## Starter Files

### file: warm-cache.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
# read a large file to populate the page cache (simulate a busy box with warm cache)
f=$(mktemp)
dd if=/dev/zero of="$f" bs=1M count=1024 status=none      # 1 GB file
cat "$f" > /dev/null                                       # read it -> fills page cache
echo "cache warmed with ~1GB; now look at: free -h"
rm -f "$f"
```

## Expected Failure

```bash
bash warm-cache.sh
free -h
#               total   used    free   shared  buff/cache   available
# Mem:           15Gi   2.1Gi   180Mi   90Mi    12Gi        12Gi
#                               ^^^^^ tiny 'free' -> looks alarming
#                                                             ^^^^^ but 12Gi AVAILABLE
```

```bash
# the "used" memory is mostly reclaimable cache, not application memory:
grep -E 'MemTotal|MemFree|MemAvailable|Cached|Buffers' /proc/meminfo
# MemAvailable:  12000000 kB     <- what can actually be given to a new process
```

`free` is tiny because Linux put idle RAM to work as page cache (`buff/cache`). That is not a
problem: `available` (12 GiB) is the reclaimable + free memory a new allocation can use. Low
`free` with high `available` is a healthy, well-utilised system — not memory pressure.

## Expected Outcome

You correctly conclude there is no memory problem (or you identify real pressure).

The distinction is clear from `free`/`/proc/meminfo`:

```bash
free -h
# 'available' is comfortably large -> no pressure, cache is doing its job
```

Real pressure, if present, shows different signs — you can rule them out:

```bash
# swap activity and reclaim stalls indicate REAL pressure:
vmstat 1 3                 # si/so (swap in/out) near 0 = fine
grep -E 'some avg' /proc/pressure/memory 2>/dev/null   # PSI: near 0 = no stalls
dmesg | grep -i 'out of memory' | tail                 # no recent OOM kills
```

The cache proves reclaimable — a large allocation succeeds by evicting cache, not by
swapping or OOM:

```bash
# available drops into free as the kernel reclaims cache on demand; no OOM occurs
```

## Hints

### Hint 1 — Read 'available', not 'free'

`free` = totally unused RAM (Linux keeps this small on purpose). `buff/cache` = page cache
and buffers, reclaimable on demand. `available` (MemAvailable) = an estimate of how much a
new process can get without swapping — the number that reflects real headroom. Low `free` +
high `available` = healthy.

### Hint 2 — Confirm pressure with swap and PSI, not free

Real memory pressure shows as sustained swapping (`vmstat` si/so > 0, `swap used` climbing),
memory PSI stalls (`/proc/pressure/memory`), reclaim thrashing, and OOM kills in `dmesg`. If
those are quiet, a small `free` is just efficient caching. Do not "fix" it by dropping caches
in production (`drop_caches` is a diagnostic/benchmark tool, not a remedy — it just makes the
next reads slow).

## Solution

Interpret the numbers correctly: the box is healthy; the cache is reclaimable.

```bash
# 1) the right metric
free -h                                   # compare 'free' (small) vs 'available' (large)
awk '/MemAvailable/{print $2/1024 " MiB available"}' /proc/meminfo

# 2) rule out REAL pressure
vmstat 1 3                                # si/so ~ 0 -> not swapping
cat /proc/pressure/memory 2>/dev/null     # 'some'/'full' avg near 0 -> no stalls
dmesg | grep -i 'out of memory' | tail    # no OOM kills

# 3) conclusion: no action needed. The cache frees itself when apps need RAM.
#    (Only if benchmarking:  sync; echo 3 | sudo tee /proc/sys/vm/drop_caches )
```

- **Linux deliberately uses free RAM as page cache** to avoid slow disk reads. That memory
  shows as `used`/`buff/cache` but is reclaimable instantly — idle RAM is wasted RAM, by design.
- **`available`, not `free`, is the headroom metric.** `free` stays small on a healthy busy
  system; `available` estimates what a new process can actually get. Alert on `available` (and
  swap/PSI), never on `free`.
- **Real pressure has distinct signatures**: sustained swap in/out (`vmstat` si/so), rising
  swap usage, memory PSI stalls, reclaim thrash, and OOM kills. Absent those, low free memory is
  a non-event.
- **Do not `drop_caches` in production to "free" memory.** It only discards useful cache and
  slows the next operations; the kernel already reclaims cache on demand. It is a
  benchmarking/diagnostic knob, not a fix.
- **This misreading causes real harm** — needless RAM purchases, panic restarts, and bad
  autoscaling rules — all from watching the wrong column. Teach dashboards to show `available`.

# You deleted the huge log and the disk is still full

## Briefing

A service filled the disk with a giant log file. You `rm`'d it, but `df` still shows the
space used, and it will not come back until you do something more. The bytes are gone from
the directory listing but not from the filesystem.

On Unix, deleting a file only removes the *name* (the directory entry). The data is freed
only when the last open file handle to it closes. A running process still has the log open,
so the space stays allocated to an unlinked file until that process closes it or exits.

## Your Task

- Fill a disk with a log, delete the file, and observe that space is not reclaimed.
- Find the process still holding the deleted file open.
- Reclaim the space without necessarily killing the service.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
# a process that opens a log and keeps writing/holding it
: > big.log
# background writer that keeps the file open (simulates a long-running service)
( exec 9> big.log; for i in $(seq 1 100000); do echo "line $i padding padding padding" >&9; sleep 0.001; done ) &
echo "writer PID: $!"
sleep 1
echo "log size: $(du -h big.log | cut -f1)"
echo "now: rm big.log   (space will NOT be reclaimed while the writer holds it open)"
```

## Expected Failure

```bash
bash setup.sh
rm big.log
df -h .        # used space unchanged
du -sh .       # du shows LESS than df: the classic 'deleted but open' signature
```

```bash
# the space is held by a deleted-but-open file:
lsof +L1 2>/dev/null | grep deleted
# writer  12345  you   9w  REG  8,1  52428800  0  /path/big.log (deleted)
#                                              ^ link count 0 = no name, still open
```

`rm` removed the directory entry, but the writer still holds file descriptor 9 open. The
kernel keeps the data until that descriptor closes. `df` (filesystem accounting) still
counts it; `du` (walks names) does not — the gap between them is the tell.

## Expected Outcome

Space is reclaimed and `df` agrees with `du`.

The deleted-but-open file is gone:

```bash
lsof +L1 2>/dev/null | grep deleted
# (no output)
```

Space returns:

```bash
df -h .        # used space dropped by the log's size
```

Ideally without downtime — truncate via the open fd, or signal the service to reopen its
log, rather than killing it:

```bash
# reclaim in place by truncating the still-open file through /proc:
: > "/proc/<pid>/fd/9"       # or use truncate on the fd path
df -h .        # space reclaimed, service still running
```

## Hints

### Hint 1 — Deleted-but-open is a link-count-zero file

A file's data lives until its link count (names) AND open handles both reach zero. `rm`
drops the name; an open fd keeps the data. Signs: `df` shows used space but `du` cannot
find it, and `lsof +L1` (or `lsof | grep deleted`) lists the file with `(deleted)`.

### Hint 2 — Reclaim without killing, if you can

You do not always have to kill the process. Truncating the still-open descriptor frees the
bytes immediately: `: > /proc/<pid>/fd/<n>` (write nothing to the fd path under `/proc`).
Or send the service its "reopen logs" signal (many use `SIGHUP` or a `logrotate`
`postrotate` reload). Killing/restarting the process also closes the fd — a blunt last
resort. The real fix is log rotation so logs never grow unbounded.

## Solution

The log was deleted while a process held it open, so the space was not freed. Find the
holder and truncate its descriptor (or restart the service).

```bash
# 1) confirm the signature
df -h .            # used
du -sh .           # much smaller -> deleted-but-open

# 2) find the holder and the fd number
lsof +L1 2>/dev/null | grep deleted
# writer  12345 you 9w REG ... /path/big.log (deleted)

# 3a) reclaim in place (no downtime): truncate the open fd
: > /proc/12345/fd/9
df -h .            # space reclaimed

# 3b) or signal the service to reopen its logs (SIGHUP for many daemons)
#     kill -HUP 12345
# 3c) or, last resort, restart the process to close the fd
```

- **`rm` removes a name, not necessarily the data.** Data is freed only when link count and
  open handles are both zero. A process holding the file open keeps the bytes allocated
  after the name is gone.
- **`df` vs `du` divergence is the fingerprint.** `df` counts filesystem allocation
  (including deleted-but-open files); `du` sums files it can *name*. `df` > `du` means space
  is held by unlinked-but-open files.
- **`lsof +L1` finds them** — files with link count < 1 that are still open, shown as
  `(deleted)`, with the owning PID and fd number.
- **Reclaim without downtime** by truncating `/proc/<pid>/fd/<n>` or sending the service its
  log-reopen signal; killing the process is the blunt option. The permanent fix is log
  rotation (logrotate with `copytruncate` or a proper reopen), so a log never grows to fill
  the disk.
- **This is why "I deleted the file but the disk is still full" is common** for databases
  and long-running daemons — they hold their files open for their whole lifetime.

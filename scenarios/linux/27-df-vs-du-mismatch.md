# df says full, du says half — where did the space go

## Briefing

`df` reports the filesystem is 100% full, but `du -sh` of everything on it adds up to far
less. Files you can see do not account for the used space. The bytes are real, but they are
hidden from a normal directory walk.

`df` asks the filesystem how much space is allocated; `du` sums the files it can *reach by
name*. They diverge when space is held by things `du` cannot see: deleted-but-open files, or
files hidden underneath a mount point that was mounted over a non-empty directory.

## Your Task

- Create a df/du discrepancy and confirm the filesystem is genuinely full while `du` is
  short.
- Identify which of the two classic causes is responsible (open-deleted files, or shadowed
  files under a mount).
- Reclaim or reveal the space.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
# Cause 1: a deleted-but-open file holding space
dd if=/dev/zero of=/tmp/lab-big bs=1M count=512 status=none
( exec 7< /tmp/lab-big; rm /tmp/lab-big; echo "holder PID with deleted file open: $$"; sleep 3600 ) &
echo "deleted-but-open holder started (PID $!)"

# Cause 2 (illustration): files shadowed by a mount over a non-empty dir
#   mkdir -p /mnt/point ; echo hidden > /mnt/point/ghost.txt  (space used)
#   mount /dev/sdX /mnt/point                                 (ghost.txt now shadowed)
#   du of /mnt/point sees the MOUNTED fs, not the hidden file underneath
echo "df will show usage that du cannot find"
```

## Expected Failure

```bash
bash setup.sh
df -h /tmp
# Filesystem  Size  Used Avail Use% Mounted on
# ...          10G  9.6G  400M  97% /tmp        <- nearly full

du -sh /tmp 2>/dev/null
# 3.1G   /tmp                                   <- du finds far less than df reports used
```

```bash
# cause 1: deleted-but-open files (space with no name)
sudo lsof +L1 2>/dev/null | grep -i deleted | head
# ...  7r  REG  ...  536870912  0  /tmp/lab-big (deleted)   <- 512MB with link count 0

# cause 2: files hidden under a mount point
sudo mount --bind /empty /somedir   # anything previously in /somedir is now shadowed
```

`df` counts all allocated blocks; `du` sums reachable files. The gap is held by a
deleted-but-open file (512 MB with no name, still open on fd 7) and/or by files buried under a
mount that was placed over a non-empty directory (invisible while the mount is active).

## Expected Outcome

`df` and `du` reconcile, and the space is reclaimed or explained.

Deleted-but-open space is freed (holder closes/restarts, or its fd is truncated):

```bash
sudo lsof +L1 2>/dev/null | grep deleted   # empty after releasing
df -h /tmp                                  # used drops by the freed size
```

Shadowed files are revealed by inspecting under the mount:

```bash
# temporarily mount the underlying fs elsewhere to see what is hidden:
sudo mount --bind / /mnt/root-view
du -sh /mnt/root-view/somedir      # shows the shadowed files' real size
sudo umount /mnt/root-view
```

## Hints

### Hint 1 — Two causes, two tools

`df` (allocation) > `du` (named files) has two classic explanations. (1) Deleted-but-open
files: `lsof +L1` (or `lsof | grep deleted`) lists space held by unlinked files still open by
a process. (2) Files under a mount point: something was written to a directory, then a
filesystem was mounted over it, shadowing those files — they still consume space on the
*underlying* fs but `du` of the path sees the mounted fs instead.

### Hint 2 — Reveal or reclaim each

For deleted-but-open: find the holder and truncate its fd (`: > /proc/<pid>/fd/<n>`) or
restart it — the same technique as reclaiming a deleted log. For shadowed files: bind-mount
the parent (or the root) somewhere else and inspect the path there, or stop the mount to see
what is underneath. `du -x` keeps `du` on one filesystem so mount boundaries do not confuse
your accounting.

## Solution

Determine which cause applies, then reclaim (open-deleted) or reveal (shadowed) the space.

```bash
# 1) confirm the discrepancy on the specific fs
df -h /tmp
du -shx /tmp 2>/dev/null            # -x stays on one filesystem

# 2a) deleted-but-open files
sudo lsof +L1 2>/dev/null | grep deleted
#   reclaim without downtime: truncate the fd, or restart the holder
: > /proc/<pid>/fd/<n>              # frees the space held by the unlinked file
df -h /tmp                          # used drops

# 2b) files shadowed by a mount over a non-empty directory
mount | grep somedir               # is something mounted there?
sudo mount --bind / /mnt/root-view # view the underlying tree
du -shx /mnt/root-view/somedir     # the hidden size
sudo umount /mnt/root-view
#   fix: move/delete the shadowed files (unmount first), or relocate the data
```

- **`df` measures allocation; `du` sums reachable files.** When they disagree, space is held
  by something `du` cannot name — not by "a bug in df". The gap size hints at what to look for.
- **Deleted-but-open files** hold blocks with no directory entry until the last fd closes.
  `lsof +L1` finds them; truncating the fd or restarting the holder reclaims the space — the same
  phenomenon behind "deleted the log, disk still full".
- **Files shadowed by a mount** are written to a directory, then hidden when a filesystem is
  mounted over it. They keep consuming the underlying fs but are invisible at that path. Bind-
  mount the parent elsewhere (or unmount) to see and remove them.
- **`du -x` keeps accounting on one filesystem**, so mount points do not silently add or drop
  from your totals — essential when a tree spans several mounts.
- **Check both causes before adding disk.** The space is real and usually reclaimable; growing
  the volume without finding the holder just delays the next "full disk" page.

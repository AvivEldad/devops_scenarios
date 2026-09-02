# No space left on device, and df says the disk is half empty

## Briefing

Writes are failing with `No space left on device`, but `df -h` shows the filesystem is
only 50% full. Deleting a few files does not help. The disk has plenty of *bytes* free —
it has run out of something else.

A filesystem tracks free space in two independent pools: data blocks (bytes) and inodes
(one per file/directory). A directory full of tiny files can exhaust inodes while bytes
remain. `df` shows bytes by default; the truth is in `df -i`.

## Your Task

- Reproduce a write failure while `df -h` still shows free space.
- Determine which resource is actually exhausted.
- Reclaim it and make writes succeed again.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
# simulate an inode-heavy directory: a cache that creates one tiny file per request
mkdir -p cache
echo "creating many tiny files (this is what exhausted inodes on the real box)..."
# on a small loopback fs this would fail; here it just demonstrates the shape
for i in $(seq 1 20000); do : > "cache/item-$i.tmp"; done
echo "created $(ls cache | wc -l) files totalling $(du -sh cache | cut -f1)"
```

## Expected Failure

```bash
bash setup.sh
touch /path/on/full/fs/newfile
# touch: cannot touch 'newfile': No space left on device

df -h /path/on/full/fs
# Filesystem      Size  Used Avail Use% Mounted on
# /dev/sdb1        20G   10G  9.0G  53% /data      <- bytes look fine!
```

```bash
df -i /path/on/full/fs
# Filesystem     Inodes  IUsed IFree IUse% Mounted on
# /dev/sdb1      1310720 1310720   0  100% /data    <- inodes are 100% used
```

`df -h` measures bytes; `df -i` measures inodes. The byte pool is half free, but every
inode is consumed by tiny files, so no *new* file can be created regardless of size.

## Expected Outcome

Writes succeed again after freeing inodes.

Inode usage drops below 100%:

```bash
df -i /data
# IUse% well under 100
```

New files can be created:

```bash
touch /data/newfile && echo ok
# ok
```

The inode hog is identified — count files per directory to find it:

```bash
for d in /data/*/; do printf '%8s  %s\n' "$(find "$d" | wc -l)" "$d"; done | sort -rn | head
# the offending directory has hundreds of thousands of entries
```

## Hints

### Hint 1 — Two pools: bytes and inodes

`df -h` shows bytes; `df -i` shows inodes. `No space left on device` with free bytes is
almost always inode exhaustion — millions of tiny files (session caches, mail spools, log
fragments, PID files). Check both pools before concluding the disk is full.

### Hint 2 — Find and clear the many-small-files directory

Count entries per directory to locate the hog:
`find /data -xdev -type f | wc -l`, then narrow by subtree. Delete or archive the churned
files, and fix the source (bounded cache, log rotation). Inode count is fixed at
filesystem creation — if a workload legitimately needs more, the filesystem must be
recreated with a higher inode ratio (`mkfs -N` / `-i`).

## Solution

The filesystem ran out of inodes, not bytes. Find the directory with the file explosion
and clear it.

```bash
df -i /data                      # confirm inodes at 100%
# locate the hog
sudo du --inodes -x /data 2>/dev/null | sort -rn | head    # if du supports --inodes
# or:
for d in /data/*/; do echo "$(find "$d" -xdev | wc -l) $d"; done | sort -rn | head

# clear the churned files (example: a cache of tiny temp files)
find /data/cache -type f -name '*.tmp' -delete

df -i /data                      # IUse% now under 100
touch /data/newfile && echo ok
```

- **`No space left on device` has two causes**: no free bytes (`df -h`) or no free inodes
  (`df -i`). Always check both — the byte view alone will mislead you every time inodes are
  the problem.
- **One inode per file or directory**, allocated at filesystem creation. Workloads that
  create millions of tiny files (caches, queues, session stores) exhaust inodes long before
  bytes.
- **Find the hog by counting entries**, not by size. `du -h` shows big files; inode
  problems are about *many* files, so count with `find | wc -l` per subtree.
- **The fix is at the source**: bound the cache, rotate and compress logs, clean temp
  files. Raising the inode count requires recreating the filesystem, so prevention beats
  cure.
- **`df` counts the mounted filesystem only**; use `-x`/`-xdev` in `find`/`du` so you do not
  wander across mount points and misattribute usage.

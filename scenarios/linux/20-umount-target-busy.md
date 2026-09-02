# target is busy: the filesystem you cannot unmount

## Briefing

You need to unmount a filesystem (to replace a disk, resize, or clean up) and `umount`
refuses: `target is busy`. Something is still using the mount — an open file, a process with
its working directory there, or a nested mount — and the kernel will not let it go.

`umount` fails while any process holds a reference under the mount point. The fix is to find
what, decide whether to close/move/kill it, and only then unmount — or use a lazy/forced
unmount when appropriate, understanding the trade-offs.

## Your Task

- Create a busy mount point (open file and/or a shell `cd`'d into it) and reproduce
  `target is busy`.
- Find every process and handle keeping the mount busy.
- Unmount cleanly, using the least disruptive method.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
# simulate a mount point with activity (use a bind mount so no real device is needed)
mkdir -p /tmp/lab/src /tmp/lab/mnt
echo "data" > /tmp/lab/src/file.txt
sudo mount --bind /tmp/lab/src /tmp/lab/mnt

# make it busy: a process holding a file open AND a shell cwd inside
( exec 9< /tmp/lab/mnt/file.txt; sleep 3600 ) &
echo "holder PID: $!"
echo "also try opening another shell and: cd /tmp/lab/mnt"
echo "now attempt: sudo umount /tmp/lab/mnt"
```

## Expected Failure

```bash
bash setup.sh
sudo umount /tmp/lab/mnt
# umount: /tmp/lab/mnt: target is busy.
```

```bash
# find what is keeping it busy:
sudo lsof +f -- /tmp/lab/mnt
# COMMAND   PID USER  FD  TYPE ... NAME
# sleep    4821 you    9r REG  ... /tmp/lab/mnt/file.txt   <- open file
sudo fuser -vm /tmp/lab/mnt
#                      USER  PID ACCESS COMMAND
# /tmp/lab/mnt:        you  4821 ..f..  sleep
#                      you  4990 ..c..  bash                <- 'c' = cwd inside the mount
```

`umount` fails because at least one process references the mount: `sleep` has a file open
(`f`), and a `bash` has its current directory inside it (`c`). Either is enough to make the
target busy.

## Expected Outcome

The filesystem unmounts cleanly.

Nothing references the mount anymore:

```bash
sudo fuser -vm /tmp/lab/mnt
# (no processes listed)
```

The unmount succeeds:

```bash
sudo umount /tmp/lab/mnt && echo "unmounted"
# unmounted

mount | grep /tmp/lab/mnt || echo "not mounted"
# not mounted
```

## Hints

### Hint 1 — Find who holds it: lsof and fuser

`sudo lsof +f -- /mountpoint` lists open files under the mount; `sudo fuser -vm /mountpoint`
lists every process using it, with access flags (`f` = open file, `c` = cwd inside, `r` = root
dir, `m` = mmap'd). A shell simply sitting with `cd` inside the mount is a very common,
easily-missed cause.

### Hint 2 — Resolve, then unmount; lazy/force as trade-offs

Close the files / `cd` out / stop the processes, then `umount`. If you cannot (or a process is
wedged), `umount -l` (lazy) detaches the mount from the tree immediately and cleans up when
references drop — good for hung network mounts, but the underlying resource stays busy until
they do. `umount -f` (force) is mainly for unreachable NFS. Both can lose unflushed writes —
prefer a clean unmount when data integrity matters.

## Solution

Identify every holder, release them, then unmount.

```bash
# 1) who is using it?
sudo fuser -vm /tmp/lab/mnt
sudo lsof +f -- /tmp/lab/mnt

# 2) release: close files, leave the directory, or stop the process
#    - in the shell that is cd'd inside:   cd /
#    - stop the file holder:               kill 4821   (or close the fd)

# 3) unmount cleanly
sudo umount /tmp/lab/mnt

# 4) only if a clean unmount is impossible (e.g. hung NFS):
#    sudo umount -l /tmp/lab/mnt     # lazy detach
#    sudo umount -f /tmp/lab/mnt     # force (NFS)
```

- **"target is busy" means something still references the mount.** Open files, a process cwd
  inside it, mmapped files, or a nested submount all count. The kernel protects in-use data by
  refusing.
- **`fuser -vm` and `lsof` name the holders** — including access type. `c` (cwd) is the
  sneakiest: a forgotten shell sitting in the directory blocks unmount with no open file at all.
- **Resolve before you force.** `cd` out, close descriptors, stop processes, then `umount`.
  This is the only method guaranteed not to lose in-flight writes.
- **`umount -l` (lazy) detaches from the namespace now**, freeing the path, and completes when
  the last reference drops — ideal for hung network mounts you cannot otherwise release. `umount
  -f` is for unreachable NFS. Both risk unflushed data.
- **Check for nested mounts and loop/overlay usage** — a submount or a bind mount elsewhere can
  keep a parent busy; `findmnt -R /mountpoint` shows the whole subtree.

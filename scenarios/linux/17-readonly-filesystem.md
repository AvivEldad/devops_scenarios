# The filesystem that went read-only

## Briefing

Writes across the system suddenly fail with `Read-only file system`, even as root. Services
that log to disk crash, and you cannot even write the file that would record the problem. The
filesystem is intact but has been remounted read-only.

When the kernel detects I/O errors or corruption, the default mount option `errors=remount-ro`
protects data by switching the filesystem to read-only immediately. This is a symptom of an
underlying disk problem (failing device, corruption) — not something to simply flip back
without investigating.

## Your Task

- Recognise the read-only-filesystem symptom and confirm it (not a permissions issue).
- Find why it went read-only using the kernel log.
- Recover safely: check the filesystem, then remount read-write, understanding the risk.

## Starter Files

### file: notes.md

```text
Symptoms:
  $ touch /var/log/app.test
    touch: cannot touch '/var/log/app.test': Read-only file system
  $ echo hi | sudo tee /etc/motd
    tee: /etc/motd: Read-only file system        <- even root cannot write

This is NOT 'Permission denied' (that would be an ownership/mode issue).
'Read-only file system' means the whole mount is ro.
```

## Expected Failure

```bash
touch /var/log/app.test
# touch: cannot touch '/var/log/app.test': Read-only file system

mount | grep ' / '
# /dev/sda1 on / type ext4 (ro,relatime,errors=remount-ro)   <- 'ro', not 'rw'
```

```bash
dmesg -T | grep -i -E 'error|ext4|remount|I/O' | tail
# EXT4-fs error (device sda1): ... 
# EXT4-fs (sda1): Remounting filesystem read-only
# blk_update_request: I/O error, dev sda, sector ...          <- the disk is unhappy
```

The mount shows `ro` with `errors=remount-ro`. `dmesg` reveals the trigger: filesystem
errors or underlying block-device I/O errors. The kernel remounted read-only to prevent
further damage — the read-only state is a *consequence*, and the disk is the real problem.

## Expected Outcome

The filesystem is writable again, after the cause is understood and checked.

The mount is `rw`:

```bash
mount | grep ' / '
# /dev/sda1 on / type ext4 (rw,relatime,errors=remount-ro)

touch /var/log/app.test && echo ok
# ok
```

The filesystem was checked (ideally on a non-root fs, or offline for `/`):

```bash
# for a non-root filesystem:
sudo umount /data
sudo fsck -y /dev/sdX
sudo mount /data
```

And the hardware is assessed (SMART), because remount-ro often means a dying disk:

```bash
sudo smartctl -H /dev/sda
# SMART overall-health self-assessment test result: PASSED / FAILED
```

## Hints

### Hint 1 — Read-only filesystem ≠ permission denied

`Read-only file system` means the whole mount is `ro` (confirm with `mount` / `findmnt`).
Root cannot write either — that distinguishes it from `Permission denied` (a mode/ownership
issue on a single path). The `errors=remount-ro` option triggers this on detected errors, so
check `dmesg`/`journalctl -k` for the reason before doing anything.

### Hint 2 — Check the filesystem, do not just remount

`mount -o remount,rw /` may work temporarily, but if the FS was remounted for corruption you
risk more damage. Prefer to `fsck` first — which for the root filesystem usually means a
reboot into recovery or scheduling a check (`fsck` cannot safely run on a mounted rw root).
For a data mount, `umount` → `fsck -y` → `mount`. Then check disk health with `smartctl`;
remount-ro is frequently the first sign of a failing drive.

## Solution

Confirm it is a read-only mount, find the cause in the kernel log, check the filesystem, then
remount — and assess the hardware.

```bash
# 1) confirm
findmnt /                       # shows ro
dmesg -T | grep -i -E 'ext4|error|remount|I/O' | tail

# 2) check the filesystem (non-root example)
sudo umount /data
sudo fsck -y /dev/sdX
sudo mount /data

#    for ROOT fs: schedule a check and reboot into recovery
#    sudo touch /forcefsck   (or fsck from a live/rescue environment)

# 3) if clean and you must restore service now, remount rw (understand the risk)
sudo mount -o remount,rw /

# 4) assess the disk - remount-ro is often a dying drive
sudo smartctl -H -A /dev/sda
```

- **`Read-only file system` is a mount state, not a permission.** Even root cannot write.
  Confirm with `mount`/`findmnt` showing `ro`; that immediately rules out ownership/mode fixes.
- **`errors=remount-ro` is protection, not the problem.** The kernel flips to read-only on
  detected FS or I/O errors to stop further corruption. The real cause is in `dmesg`/`journalctl
  -k` — read it before reacting.
- **Check before you remount rw.** Blindly `remount,rw` on a filesystem that went ro for
  corruption can worsen the damage. `fsck` first; for the root filesystem that means a
  recovery/live environment or a scheduled boot-time check, since fsck cannot safely run on a
  mounted rw root.
- **Suspect the hardware.** Remount-ro is frequently the first visible sign of a failing disk
  or a flaky controller/cable. Run `smartctl -H -A`, check for reallocated sectors, and plan
  replacement/backups.
- **You may not be able to log the incident locally** (the disk is read-only) — capture
  `dmesg` output to another host or your screen immediately, before a reboot clears the
  in-memory evidence.

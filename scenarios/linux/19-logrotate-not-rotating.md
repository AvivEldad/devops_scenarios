# The logs that grew until the disk was full

## Briefing

A service's log file is 40 GB and still growing. There is a logrotate config for it, but the
file never rotates — or it rotates and the service keeps writing to the old (renamed) file, so
the new log stays empty and the disk keeps filling.

logrotate renames the log and expects the service to start a fresh one. If the service holds
the file open and is not told to reopen it, it keeps writing to the renamed (or deleted) inode.
`copytruncate` and `postrotate` reload directives exist precisely to handle this.

## Your Task

- Reproduce a log that does not rotate, or rotates but keeps growing the old inode.
- Explain why renaming a log a running process holds open does not start a new file.
- Configure rotation so the log is bounded and the service writes to the fresh file.

## Starter Files

### file: app-logger.sh

```bash
#!/usr/bin/env bash
# A service that opens its log once and keeps writing (does NOT reopen on rotate).
set -euo pipefail
LOG=/var/log/demo/app.log
mkdir -p "$(dirname "$LOG")"
exec 9>>"$LOG"                      # open the log on fd 9 for the whole process lifetime
while true; do echo "$(date +%T) working" >&9; sleep 1; done
```

### file: demo.logrotate

```text
/var/log/demo/app.log {
    daily
    rotate 7
    missingok
    notifempty
    # BUG: no 'copytruncate' and no 'postrotate' reload,
    # so a process holding the file open keeps writing to the renamed inode.
}
```

## Expected Failure

```bash
# with the app running and holding the log open:
sudo logrotate -f /etc/logrotate.d/demo        # force a rotation
ls -l /var/log/demo/
# app.log      0 bytes      <- new file, but the service is NOT writing here
# app.log.1    40G  (grows) <- the service still writes to the renamed inode!
```

```bash
# proof the service holds the old (renamed) file open:
lsof -p "$(pgrep -f app-logger)" | grep app.log
# app-logg ... 9w REG ... /var/log/demo/app.log.1     <- writing to the rotated file
```

logrotate renamed `app.log` to `app.log.1`, but the service still holds that inode open on fd
9 and keeps appending to it. The new `app.log` stays empty, and the disk keeps filling via
`app.log.1`. Rotation "ran" but achieved nothing.

## Expected Outcome

Logs rotate and the service writes to the fresh file.

After rotation, the new log grows and the old one is stable/compressed:

```bash
sudo logrotate -f /etc/logrotate.d/demo
ls -l /var/log/demo/
# app.log     (growing - service writes here now)
# app.log.1.gz (compressed, no longer growing)
```

The service's open handle points at the current file:

```bash
lsof -p "$(pgrep -f app-logger)" | grep app.log
# ... 9w REG ... /var/log/demo/app.log       <- back on the live file
```

Old logs are pruned so disk stays bounded:

```bash
ls /var/log/demo/ | wc -l      # bounded by 'rotate N'
```

## Hints

### Hint 1 — Renaming does not make a process reopen

A running process writes to an *open file descriptor*, which follows the inode, not the name.
When logrotate renames `app.log` to `app.log.1`, the process keeps writing to the same inode
(now under the new name). Two standard fixes: `copytruncate` (logrotate copies then truncates
the original in place, so the fd keeps working on a now-empty file) or a `postrotate` step
that signals the service to reopen its log.

### Hint 2 — copytruncate vs postrotate reload

`copytruncate` is simplest and needs no app cooperation, but has a tiny race (log lines
written between copy and truncate can be lost) and briefly doubles disk use. A `postrotate`
reload (e.g. `systemctl reload app` or `kill -USR1`/`-HUP` to a daemon that reopens on that
signal) is cleaner and lossless when the app supports it. Also confirm logrotate actually runs
(its cron/timer) and that ownership/permissions let it rotate.

## Solution

Make rotation account for the held-open file, either by truncating in place or by telling the
service to reopen.

```text
# option A: copytruncate (no app changes needed)
/var/log/demo/app.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
    copytruncate            # copy then truncate original -> fd keeps writing to the empty file
}
```

```text
# option B: signal the service to reopen (lossless, preferred if supported)
/var/log/demo/app.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
    postrotate
        systemctl reload demo.service 2>/dev/null || kill -HUP "$(pgrep -f app-logger)"
    endscript
}
```

```bash
sudo logrotate -f /etc/logrotate.d/demo
lsof -p "$(pgrep -f app-logger)" | grep app.log     # now on the live app.log
```

- **A process writes to an inode via its open fd, not to a filename.** Renaming the log (what
  logrotate does) leaves the process writing to the same inode under its new name — the new file
  stays empty and the disk keeps filling.
- **`copytruncate`** copies the log then truncates the original in place, so the held-open fd
  continues on a now-empty file. Simplest, app-agnostic, but has a small race window and briefly
  uses extra space.
- **`postrotate` + reload/signal** tells the service to close and reopen its log after
  rotation — lossless and clean, when the app supports a reopen signal (`SIGHUP`/`SIGUSR1`) or a
  `reload`.
- **Confirm logrotate actually runs.** It is driven by cron or a systemd timer; if that is
  broken, no config matters. Test with `logrotate -d` (debug/dry-run) and `-f` (force).
- **Permissions and `su`/`create` directives matter** — logrotate must be able to rename in
  the directory and recreate the file with the right owner, or rotation silently fails.
- **The same "renamed but still open" logic** explains why deleting a big log frees no space
  until the writer reopens — it is the deleted-but-open-file phenomenon in another guise.
